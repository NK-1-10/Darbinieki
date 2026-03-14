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

// --- 1. AUTENTIFIKĀCIJA ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const query = 'SELECT * FROM users WHERE name = $1 AND (password = $2 OR temp_password = $2)';
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

app.post('/api/change-password', async (req, res) => {
    const { username, newPassword } = req.body;
    try {
        await pool.query('UPDATE users SET password = $1, temp_password = NULL WHERE name = $2', [newPassword, username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. RESURSU PĀRVALDĪBA ---
app.get('/api/resource-types', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name, quantity FROM resource_types ORDER BY name ASC");
        res.json(r.rows); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/resource-types/:id', async (req, res) => {
    const { id } = req.params;
    const { action, amount } = req.body;
    const litri = parseFloat(amount) || 0;
    try {
        const checkRes = await pool.query('SELECT name, quantity FROM resource_types WHERE id = $1', [id]);
        if (checkRes.rows.length === 0) return res.status(404).json({ error: 'Resurss nav atrasts' });
        const currentQty = parseFloat(checkRes.rows[0].quantity) || 0;

        if (action === 'sub') {
            if (currentQty < litri) return res.status(400).json({ error: `Noliktavā nepietiek! Pieejams: ${currentQty}L` });
            const result = await pool.query('UPDATE resource_types SET quantity = quantity - $1 WHERE id = $2 RETURNING *', [litri, id]);
            res.json(result.rows[0]);
        } else {
            const query = action === 'add' ? 'UPDATE resource_types SET quantity = quantity + $1 WHERE id = $2 RETURNING *' : 'UPDATE resource_types SET quantity = $1 WHERE id = $2 RETURNING *';
            const result = await pool.query(query, [litri, id]);
            res.json(result.rows[0]);
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. SARAKSTU DATI ---
app.get('/api/cars', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM cars ORDER BY name ASC");
        res.json(r.rows.map(row => row.name));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/objects', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM objects ORDER BY name ASC");
        res.json(r.rows.map(row => row.name));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/work-types', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM work_types ORDER BY name ASC");
        res.json(r.rows.map(row => row.name));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. DARBA GAITA ---
app.get('/api/schedule', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedule ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body;
    const parts = start_time.split(' '); 
    const date = parts[0];
    const time = parts[1];
    const months = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs","Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];
    const monthStr = months[parseInt(date.split('.')[1]) - 1] || "Nezināms";

    try {
        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, "sākuma_laiks", month, objekts, darbs) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [worker_name, car, date, time, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stop-work', async (req, res) => {
    const { worker_name, end_time } = req.body;
    const timeOnly = end_time.split(' ')[1];
    try {
        const active = await pool.query('SELECT id, "sākuma_laiks" FROM schedule WHERE worker_name=$1 AND "beigu_laiks" IS NULL ORDER BY id DESC LIMIT 1', [worker_name]);
        if (active.rows.length > 0) {
            const start = active.rows[0].sākuma_laiks;
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = timeOnly.split(':').map(Number);
            let diffMin = (eh * 60 + em) - (sh * 60 + sm);
            if (diffMin < 0) diffMin += 1440;
            const hoursStr = (diffMin / 60).toFixed(2);

            await pool.query('UPDATE schedule SET "beigu_laiks"=$1, hours=$2 WHERE id=$3', [timeOnly, hoursStr, active.rows[0].id]);
            res.json({ success: true });
        } else { res.status(404).json({ error: "Nav aktīva darba" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-resources', async (req, res) => {
    const { worker_name, car, type, amount } = req.body;
    const column = type === 'Ella' ? 'pielietā_eļļa' : 'pielietā_degviela';
    const litri = parseFloat(amount) || 0;
    const tagad = new Date();
    const datums = tagad.toLocaleDateString('lv-LV');
    const laiks = tagad.toLocaleTimeString('lv-LV');

    try {
        const activeJob = await pool.query('SELECT id FROM schedule WHERE worker_name = $1 AND "beigu_laiks" IS NULL ORDER BY id DESC LIMIT 1', [worker_name]);
        if (activeJob.rows.length > 0) {
            await pool.query(`UPDATE schedule SET "${column}" = (COALESCE(NULLIF("${column}", ''), '0')::numeric + $1)::text WHERE id = $2`, [litri, activeJob.rows[0].id]);
        } else {
            const months = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs","Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];
            await pool.query(
                `INSERT INTO schedule (worker_name, car, date, "sākuma_laiks", "beigu_laiks", month, "${column}", darbs) VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
                [worker_name, car, datums, laiks, months[tagad.getMonth()], litri.toString(), type === 'Ella' ? 'Eļļas papildināšana' : 'Degvielas uzpilde']
            );
        }
        res.sendStatus(200);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/darba-stundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        await pool.query('INSERT INTO darbastundas (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1, $2, $3, $4, $5, $6)', [darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas]);
        res.status(200).send("OK");
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
