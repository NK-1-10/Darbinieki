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

// --- PALĪGFUNKCIJA LAIKA STARPĪBAI ---
function calculateHours(start, end) {
    const [sh, sm, ss] = start.split(':').map(Number);
    const [eh, em, es] = end.split(':').map(Number);
    let diff = (eh * 3600 + em * 60 + es) - (sh * 3600 + sm * 60 + ss);
    if (diff < 0) diff += 86400; 
    return (diff / 3600).toFixed(2);
}

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
        if (action === 'sub') {
            await pool.query('UPDATE resource_types SET quantity = COALESCE(quantity, 0) - $1 WHERE id = $2', [litri, id]);
        } else {
            let query = action === 'add' ? 'UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE id = $2' : 'UPDATE resource_types SET quantity = $1 WHERE id = $2';
            await pool.query(query, [litri, id]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. DARBINIEKI, AUTO, OBJEKTI ---
app.get('/api/workers', async (req, res) => {
    try {
        const r = await pool.query("SELECT name, temp_password, role FROM users WHERE role != 'admin' OR role IS NULL ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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

// --- 4. DARBA GAITA (SCHEDULE) ---
app.get('/api/schedule', async (req, res) => {
    const { worker_name } = req.query;
    try {
        let query = 'SELECT * FROM schedule';
        let params = [];
        if (worker_name) {
            query += ' WHERE LOWER(worker_name) = LOWER($1)';
            params.push(worker_name);
        }
        query += ' ORDER BY id DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: JAUNU VIENĪBU PIEVIENOŠANA ---

app.post('/api/workers', async (req, res) => {
    const { name } = req.body;
    try {
        await pool.query('INSERT INTO users (name, temp_password, role) VALUES ($1, $2, $3)', [name, '12345', 'worker']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cars', async (req, res) => {
    try {
        await pool.query('INSERT INTO cars (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/work-types', async (req, res) => {
    try {
        await pool.query('INSERT INTO work_types (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/objects', async (req, res) => {
    try {
        await pool.query('INSERT INTO objects (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/resource-types', async (req, res) => {
    const { name, quantity } = req.body;
    try {
        await pool.query('INSERT INTO resource_types (name, quantity) VALUES ($1, $2)', [name, quantity || 0]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: KRĀJUMU PAPILDINĀŠANA (Poga OK) ---

app.post('/api/resource-stock', async (req, res) => {
    const { name, change } = req.body; // change var būt pozitīvs (pievienot) vai negatīvs (noņemt)
    try {
        const result = await pool.query(
            'UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE name = $2 RETURNING *',
            [parseFloat(change), name]
        );
        if (result.rowCount > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Resurss nav atrasts" });
        }
    } catch (err) { res.status(500).json({ error: "DB kļūda" }); }
});

// --- ADMIN: DZĒŠANAS FUNKCIJAS ---

app.delete('/api/cars/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM cars WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/objects/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM objects WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/work-types/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM work_types WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/resource-types/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM resource_types WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/workers/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// (Pievieno līdzīgus delete maršrutus cars, objects un work-types)

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body;
    const [date, time] = start_time.split(' ');
    try {
        const activeCheck = await pool.query(
            "SELECT id FROM schedule WHERE worker_name = $1 AND beigu_laiks IS NULL AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana')",
            [worker_name]
        );
        if (activeCheck.rows.length > 0) return res.status(400).json({ error: "Aktīva sesija jau eksistē!" });

        const tagad = new Date();
        const monthStr = tagad.toLocaleDateString('lv-LV', { month: 'long' }).replace(/^\w/, c => c.toUpperCase());

        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [worker_name, car, date, time, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stop-work', async (req, res) => {
    const { worker_name, end_time } = req.body;
    const timeOnly = end_time.split(' ')[1];
    try {
        const active = await pool.query(
            "SELECT id, sākuma_laiks FROM schedule WHERE worker_name=$1 AND beigu_laiks IS NULL AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana') ORDER BY id DESC LIMIT 1",
            [worker_name]
        );
        if (active.rows.length > 0) {
            const rowId = active.rows[0].id;
            const hoursStr = calculateHours(active.rows[0].sākuma_laiks, timeOnly);
            await pool.query('UPDATE schedule SET beigu_laiks=$1, hours=$2 WHERE id=$3', [timeOnly, hoursStr, rowId]);
            res.json({ success: true });
        } else { res.status(404).json({ error: "Nav aktīva darba." }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-resources', async (req, res) => {
    const { worker_name, car, resource_name, resource_amount, type } = req.body;
    
    const tagad = new Date();
    const opts = { timeZone: 'Europe/Riga' };
    const datums = tagad.toLocaleDateString('lv-LV', opts);
    const laiks = tagad.toLocaleTimeString('lv-LV', { ...opts, hour12: false });
    const monthStr = tagad.toLocaleDateString('lv-LV', { ...opts, month: 'long' }).replace(/^\w/, c => c.toUpperCase());

    try {
        // 1. IERAKSTĀM VĒSTURĒ (Schedule tabulā)
        await pool.query(`
            INSERT INTO schedule (
                worker_name, car, date, sākuma_laiks, beigu_laiks, 
                month, resource_name, resource_amount, 
                pielietā_eļļa, pielietā_degviela, darbs, hours
            ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 0)`,
        [
            worker_name, 
            car, 
            datums, 
            laiks, 
            monthStr, 
            resource_name, 
            resource_amount, 
            (type === 'Ella' ? resource_amount : null), 
            (type === 'Degviela' ? resource_amount : null), 
            (type === 'Ella' ? 'Eļļas papildināšana' : 'Degvielas uzpilde')
        ]);

        // 2. ATŅEMAM NO NOLIKTAVAS (resource_types tabulā)
        await pool.query(
            'UPDATE resource_types SET quantity = COALESCE(quantity, 0) - $1 WHERE name = $2',
            [parseFloat(resource_amount), resource_name]
        );

        // Tikai tagad sūtām atbildi, kad abas darbības veiksmīgas
        res.json({ success: true });

    } catch (err) {
        console.error("Resursu atjaunošanas kļūda:", err);
        res.status(500).json({ error: "Servera kļūda saglabājot datus" });
    }
});

// --- 5. DARBA STUNDAS ---
app.get('/api/darba-stundas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM "darbastundas" ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/darba-stundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        await pool.query('INSERT INTO "darbastundas" (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1, $2, $3, $4, $5, $6)', [darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas]);
        res.status(200).send("OK");
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 6. IZTĪRĪŠANA ---
app.delete('/api/schedule', async (req, res) => {
    try { await pool.query('DELETE FROM schedule'); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
