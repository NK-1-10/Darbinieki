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
    ssl: { rejectUnauthorized: false } // Nepieciešams Railway/Render mākoņpakalpojumiem
});

// ==========================================
// 1. LIETOTĀJU UN DARBINIEKU PĀRVALDĪBA
// ==========================================

app.get('/api/workers', async (req, res) => {
    try {
        const result = await pool.query("SELECT name, temp_password FROM users WHERE role = 'worker'");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/workers', async (req, res) => {
    const { name, temp_password } = req.body;
    try {
        await pool.query('INSERT INTO users (name, temp_password, role) VALUES ($1, $2, $3)', [name, temp_password, 'worker']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/workers/:name', async (req, res) => {
    const workerName = req.params.name;
    try {
        await pool.query('DELETE FROM users WHERE name = $1 AND role = $2', [workerName, 'worker']);
        res.json({ success: true, message: `Darbinieks ${workerName} izdzēsts.` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE name = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Lietotājs nav atrasts" });
        
        const user = result.rows[0];

        // Pagaidu paroles pārbaude
        if (user.temp_password && password === user.temp_password) {
            return res.json({ name: user.name, role: user.role, needsPasswordChange: true });
        } 
        
        // Parastās paroles pārbaude
        if (user.password && password === user.password) {
            return res.json({ name: user.name, role: user.role, needsPasswordChange: false });
        }

        res.status(401).json({ error: "Nepareiza parole" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/change-password', async (req, res) => {
    const { username, newPassword } = req.body;
    try {
        await pool.query('UPDATE users SET password = $1, temp_password = NULL WHERE name = $2', [newPassword, username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 2. RESURSU PĀRVALDĪBA (MAŠĪNAS, OBJEKTI, VEIDI)
// ==========================================

// Mašīnas
app.get('/api/cars', async (req, res) => {
    try {
        const result = await pool.query("SELECT name FROM cars ORDER BY name ASC");
        res.json(result.rows.map(row => row.name));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cars', async (req, res) => {
    try {
        await pool.query('INSERT INTO cars (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cars/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM cars WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Darba veidi
app.get('/api/work-types', async (req, res) => {
    try {
        const result = await pool.query("SELECT name FROM work_types ORDER BY name ASC");
        res.json(result.rows.map(row => row.name));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/work-types', async (req, res) => {
    try {
        await pool.query('INSERT INTO work_types (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/work-types/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM work_types WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Objekti
app.get('/api/objects', async (req, res) => {
    try {
        const result = await pool.query("SELECT name FROM objects ORDER BY name ASC");
        res.json(result.rows.map(row => row.name));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/objects', async (req, res) => {
    try {
        await pool.query('INSERT INTO objects (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/objects/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM objects WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 3. DARBA GRAFIKS UN ATSKAITES (SCHEDULE)
// ==========================================

app.get('/api/schedule', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM schedule ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/schedule', async (req, res) => {
    try {
        await pool.query("DELETE FROM schedule");
        res.json({ success: true, message: "Tabula iztīrīta" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body; 
    try {
        const [datePart, timePart] = start_time.split(' ');
        const monthNames = ["Janvāris", "Februāris", "Marts", "Aprīlis", "Maijs", "Jūnijs", "Jūlijs", "Augusts", "Septembris", "Oktobris", "Novembris", "Decembris"];
        const monthIndex = parseInt(datePart.split('.')[1]) - 1;
        const monthStr = monthNames[monthIndex];

        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
            if (totalMinutes < 0) totalMinutes += 1440; // 24 * 60

            const diffHours = (totalMinutes / 60).toFixed(2);
            await pool.query(
                'UPDATE schedule SET beigu_laiks = $1, hours = $2 WHERE worker_name = $3 AND beigu_laiks IS NULL',
                [timePart, diffHours, worker_name]
            );
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Nav aktīva darba seansa" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 4. MAIŅU UZSKAITE (DARBA STUNDAS)
// ==========================================

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

app.delete('/api/darba-stundas', async (req, res) => {
    try {
        await pool.query("DELETE FROM darba_stundas");
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// SERVERA PALAIŠANA
// ==========================================

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveris griežas uz portu ${PORT}`));
