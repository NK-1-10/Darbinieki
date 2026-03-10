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

// --- 1. IELOGOŠANĀS ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const query = `
            SELECT * FROM users 
            WHERE name = $1 AND (password = $2 OR temp_password = $2)
        `;
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
    } catch (err) {
        res.status(500).json({ error: "Servera kļūda" });
    }
});

app.post('/api/change-password', async (req, res) => {
    const { username, newPassword } = req.body;
    try {
        await pool.query(
            'UPDATE users SET password = $1, temp_password = NULL WHERE name = $2',
            [newPassword, username]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. DARBINIEKU PĀRVALDĪBA ---
app.get('/api/workers', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name, temp_password, role FROM users WHERE role != 'admin' OR role IS NULL ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/workers', async (req, res) => {
    const { name, temp_password } = req.body;
    try {
        await pool.query('INSERT INTO users (name, temp_password, role) VALUES ($1, $2, $3)', [name, temp_password, 'worker']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/workers/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. PAMATA DATI (Cars, Objects, Work-types) ---
app.get('/api/cars', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name FROM cars ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cars', async (req, res) => {
    try {
        await pool.query('INSERT INTO cars (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cars/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM cars WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/objects', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name FROM objects ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/objects', async (req, res) => {
    try {
        await pool.query('INSERT INTO objects (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/objects/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM objects WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/work-types', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name FROM work_types ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/work-types', async (req, res) => {
    try {
        await pool.query('INSERT INTO work_types (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/work-types/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM work_types WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. RESURSU NOLIKTAVA (Eļļa, Degviela) ---
app.get('/api/resource-types', async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, quantity FROM resource_types ORDER BY name ASC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/resource-types/topup', async (req, res) => {
    const { id, amount } = req.body;
    try {
        await pool.query(
            "UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE id = $2",
            [parseFloat(amount), id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/resource-types/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM resource_types WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. DARBA GAITA (SCHEDULE) ---
app.get('/api/schedule', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schedule ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body;
    const parts = start_time.split(' ');
    const date = parts[0];
    const time = parts[1];
    
    const months = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs","Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];
    const monthIndex = parseInt(date.split('.')[1]) - 1;
    const monthStr = months[monthIndex] || "Februāris";

    try {
        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [worker_name, car, date, time, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/stop-work', async (req, res) => {
    const { worker_name, end_time } = req.body;
    const timeOnly = end_time.split(' ')[1];
    try {
        const active = await pool.query('SELECT sākuma_laiks FROM schedule WHERE worker_name=$1 AND beigu_laiks IS NULL', [worker_name]);
        if (active.rows.length > 0) {
            const start = active.rows[0].sākuma_laiks;
            const [sh, sm, ss] = start.split(':').map(Number);
            const [eh, em, es] = timeOnly.split(':').map(Number);
            let diff = (eh * 3600 + em * 60 + es) - (sh * 3600 + sm * 60 + ss);
            if (diff < 0) diff += 86400;
            const hoursStr = (diff / 3600).toFixed(2);
            await pool.query(
                'UPDATE schedule SET beigu_laiks=$1, hours=$2 WHERE worker_name=$3 AND beigu_laiks IS NULL',
                [timeOnly, hoursStr, worker_name]
            );
            res.json({ success: true });
        } else { res.status(404).json({ error: "Nav aktīva darba" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Resursu atjaunināšana ar automātisku atņemšanu no noliktavas
app.post('/api/update-resources', async (req, res) => {
    const { worker_name, car, type, amount } = req.body;
    const column = type === 'Ella' ? 'pielietā_eļļa' : 'pielietā_degviela';
    const litri = parseFloat(amount) || 0;

    const tagad = new Date();
    const datums = tagad.toLocaleDateString('lv-LV');
    const laiks = tagad.toLocaleTimeString('lv-LV');
    const months = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs","Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];
    const monthStr = months[tagad.getMonth()];

    try {
        // 1. Atņemam no noliktavas
        await pool.query(
            "UPDATE resource_types SET quantity = quantity - $1 WHERE name = $2",
            [litri, type]
        );

        // 2. Ierakstām darba gaitā
        const activeJob = await pool.query(
            'SELECT id FROM schedule WHERE worker_name = $1 AND beigu_laiks IS NULL ORDER BY id DESC LIMIT 1',
            [worker_name]
        );

        if (activeJob.rows.length > 0) {
            await pool.query(
                `UPDATE schedule 
                 SET "${column}" = (COALESCE(NULLIF("${column}", ''), '0')::numeric + $1)::text 
                 WHERE id = $2`,
                [litri, activeJob.rows[0].id]
            );
        } else {
            await pool.query(
                `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, beigu_laiks, month, "${column}", darbs) 
                 VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
                [worker_name, car, datums, laiks, monthStr, litri.toString(), type === 'Ella' ? 'Eļļas papildināšana' : 'Degvielas uzpilde']
            );
        }
        res.sendStatus(200);
    } catch (err) {
        console.error("Database Error:", err);
        res.status(500).send("Sistēmas kļūda: " + err.message);
    }
});

// --- 6. ATSKAITES ---
app.get('/api/darba-stundas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM "darbastundas" ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/darba-stundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        await pool.query(
            'INSERT INTO "darbastundas" (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1, $2, $3, $4, $5, $6)',
            [darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas]
        );
        res.status(200).send("OK");
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
