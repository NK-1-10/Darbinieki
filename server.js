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

// --- LIETOTĀJI UN AUTENTIFIKĀCIJA ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE name = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Lietotājs nav atrasts" });
        const user = result.rows[0];

        if (user.temp_password && password === user.temp_password) {
            return res.json({ name: user.name, role: user.role, needsPasswordChange: true });
        } 
        if (user.password && password === user.password) {
            return res.json({ name: user.name, role: user.role, needsPasswordChange: false });
        }
        res.status(401).json({ error: "Nepareiza parole" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- RESURSU PĀRVALDĪBA (Mašīnas, Objekti, Darba veidi) ---
const setupResource = (endpoint, table) => {
    app.get(`/api/${endpoint}`, async (req, res) => {
        try {
            const result = await pool.query(`SELECT name FROM ${table} ORDER BY name ASC`);
            res.json(result.rows.map(r => r.name));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
    app.post(`/api/${endpoint}`, async (req, res) => {
        try {
            await pool.query(`INSERT INTO ${table} (name) VALUES ($1)`, [req.body.name]);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
    app.delete(`/api/${endpoint}/:name`, async (req, res) => {
        try {
            await pool.query(`DELETE FROM ${table} WHERE name = $1`, [req.params.name]);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
};

setupResource('cars', 'cars');
setupResource('objects', 'objects');
setupResource('work-types', 'work_types');

// --- DARBA GRAFIKS (schedule tabula - image_92f4c6.png) ---
app.get('/api/schedule', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM schedule ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body; 
    try {
        const [datePart, timePart] = start_time.split(' ');
        const monthNames = ["Janvāris", "Februāris", "Marts", "Aprīlis", "Maijs", "Jūnijs", "Jūlijs", "Augusts", "Septembris", "Oktobris", "Novembris", "Decembris"];
        const monthIndex = parseInt(datePart.split('.')[1]) - 1;
        const monthStr = monthNames[monthIndex];

        // Ievietojam datus atbilstoši tavai schedule tabulai
        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [worker_name, car, datePart, timePart, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stop-work', async (req, res) => {
    const { worker_name, end_time } = req.body; 
    try {
        const timePart = end_time.split(' ')[1];
        const result = await pool.query('SELECT sākuma_laiks FROM schedule WHERE worker_name = $1 AND beigu_laiks IS NULL', [worker_name]);

        if (result.rows.length > 0) {
            const startTimeStr = result.rows[0].sākuma_laiks;
            const [startH, startM] = startTimeStr.split(':').map(Number);
            const [endH, endM] = timePart.split(':').map(Number);
            
            let totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
            if (totalMinutes < 0) totalMinutes += 1440; 

            const diffHours = (totalMinutes / 60).toFixed(2);

            // Atjauninām schedule tabulu
            await pool.query(
                'UPDATE schedule SET beigu_laiks = $1, hours = $2 WHERE worker_name = $3 AND beigu_laiks IS NULL',
                [timePart, diffHours, worker_name]
            );
            res.json({ success: true, hours: diffHours });
        } else {
            res.status(404).json({ error: "Nav aktīva darba seansa" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DARBA STUNDAS (DarbaStundas tabula - image_92d6bf.png) ---
app.get('/api/darba-stundas', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM darba_stundas ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/darba-stundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        await pool.query(
            'INSERT INTO darba_stundas (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1, $2, $3, $4, $5, $6)',
            [darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveris strādā uz portu ${PORT}`));
