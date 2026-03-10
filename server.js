const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- HELPER: Mēnešu masīvs ---
const monthsLV = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs","Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];

// --- 1. AUTORIZĀCIJA ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const query = `SELECT * FROM users WHERE name = $1 AND (password = $2 OR temp_password = $2)`;
        const result = await pool.query(query, [username, password]);
        if (result.rows.length > 0) {
            const userData = result.rows[0];
            res.json({
                id: userData.id,
                name: userData.name,
                role: userData.role || "worker",
                needsPasswordChange: (userData.temp_password === password)
            });
        } else {
            res.status(401).json({ success: false, error: "Nepareizs vārds vai parole" });
        }
    } catch (err) { res.status(500).json({ error: "Servera kļūda" }); }
});

// --- 2. RESURSU NOLIKTAVA & ŽURNĀLS ---
app.get('/api/resource-types', async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, quantity FROM resource_types ORDER BY name ASC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/resource-types', async (req, res) => {
    const { name, quantity } = req.body;
    try {
        await pool.query("INSERT INTO resource_types (name, quantity) VALUES ($1, $2)", [name, quantity || 0]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/resource-types/topup', async (req, res) => {
    const { id, amount, resource_name } = req.body;
    const date = new Date().toLocaleDateString('lv-LV');
    try {
        await pool.query("UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE id = $2", [parseFloat(amount), id]);
        await pool.query("INSERT INTO inventory_log (resource_name, amount, date) VALUES ($1, $2, $3)", [resource_name, amount, date]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. PAMATA DATU IELĀDE (GET) ---
app.get('/api/workers', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name, temp_password, role FROM users WHERE role != 'admin' ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cars', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name FROM cars ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/objects', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name FROM objects ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/work-types', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name FROM work_types ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. JAUNU IERAKSTU PIEVIENOŠANA (POST) ---
app.post('/api/cars', async (req, res) => {
    try {
        await pool.query('INSERT INTO cars (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/objects', async (req, res) => {
    try {
        await pool.query('INSERT INTO objects (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/work-types', async (req, res) => {
    try {
        await pool.query('INSERT INTO work_types (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. DINAMISKĀ DZĒŠANA ---
const deleteMapping = {
    'workers': 'users',
    'cars': 'cars',
    'objects': 'objects',
    'work-types': 'work_types',
    'resource-types': 'resource_types'
};

Object.keys(deleteMapping).forEach(type => {
    app.delete(`/api/${type}/:id`, async (req, res) => {
        try {
            await pool.query(`DELETE FROM ${deleteMapping[type]} WHERE id = $1`, [req.params.id]);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
});

// --- 6. STRĀDNIEKA DARBĪBAS (Update Resources & Schedule) ---
app.get('/api/schedule', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedule ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-resources', async (req, res) => {
    const { worker_name, car, type, amount } = req.body; 
    const litri = parseFloat(amount) || 0;
    const column = type.toLowerCase().includes('degviela') ? 'pielietā_degviela' : 'pielietā_eļļa';
    const tagad = new Date();
    const monthStr = monthsLV[tagad.getMonth()];

    try {
        await pool.query("UPDATE resource_types SET quantity = quantity - $1 WHERE name = $2", [litri, type]);
        const activeJob = await pool.query('SELECT id FROM schedule WHERE worker_name = $1 AND beigu_laiks IS NULL ORDER BY id DESC LIMIT 1', [worker_name]);

        if (activeJob.rows.length > 0) {
            await pool.query(`UPDATE schedule SET "${column}" = (COALESCE(NULLIF("${column}", ''), '0')::numeric + $1)::text WHERE id = $2`, [litri, activeJob.rows[0].id]);
        } else {
            await pool.query(`INSERT INTO schedule (worker_name, car, date, sākuma_laiks, beigu_laiks, month, "${column}", darbs) VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
                [worker_name, car, tagad.toLocaleDateString('lv-LV'), tagad.toLocaleTimeString('lv-LV'), monthStr, litri.toString(), `Uzpilde: ${type}`]);
        }
        res.sendStatus(200);
    } catch (err) { res.status(500).send(err.message); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
