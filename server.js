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

// --- 1. IELOGOŠANĀS (LOGIN) ---
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

// --- 2. DARBINIEKU PĀRVALDĪBA (Adminam) ---
app.get('/api/workers', async (req, res) => {
    try {
        const r = await pool.query("SELECT name, temp_password, role FROM users WHERE role != 'admin' OR role IS NULL ORDER BY name ASC");
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

app.delete('/api/workers/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. PAMATA DATI (Cars, Objects, Work-types) ---
app.get('/api/cars', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM cars ORDER BY name ASC");
        res.json(r.rows.map(row => row.name));
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

app.get('/api/objects', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM objects ORDER BY name ASC");
        res.json(r.rows.map(row => row.name));
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

app.get('/api/work-types', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM work_types ORDER BY name ASC");
        res.json(r.rows.map(row => row.name));
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

// --- 4. DARBA GAITA (SCHEDULE) ---
app.get('/api/schedule', async (req, res) => {
    try {
        // SELECT * paņem visas kolonnas, ieskaitot pielietā_eļļa un pielietā_degviela
        const r = await pool.query("SELECT * FROM schedule ORDER BY id DESC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body;
    const [date, time] = start_time.split(' ');
    const months = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs","Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];
    const monthStr = months[parseInt(date.split('.')[1]) - 1];
    
    try {
        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [worker_name, car, date, time, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

app.delete('/api/schedule', async (req, res) => {
    try {
        await pool.query('DELETE FROM schedule');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4.5 RESURSU ATJAUNINĀŠANA (Eļļa/Degviela) ---
app.post('/api/update-resources', async (req, res) => {
    // Pievienojam 'car', ko sūtām no worker.html
    const { worker_name, car, type, amount } = req.body;
    
    const column = type === 'Ella' ? 'pielietā_eļļa' : 'pielietā_degviela';
    
    try {
        // Mēs atjauninām rindu, kas atbilst GAN darbiniekam, GAN mašīnai, un ir aktīva
        const query = `
            UPDATE schedule 
            SET ${column} = $1 
            WHERE worker_name = $2 AND car = $3 AND beigu_laiks IS NULL
        `;
        const result = await pool.query(query, [parseFloat(amount), worker_name, car]);

        if (result.rowCount > 0) {
            res.json({ success: true });
        } else {
            // Ja neatrod rindu ar šādu mašīnu, mēģinām vismaz pēc vārda
            const fallbackQuery = `
                UPDATE schedule 
                SET ${column} = $1 
                WHERE worker_name = $2 AND beigu_laiks IS NULL
            `;
            await pool.query(fallbackQuery, [parseFloat(amount), worker_name]);
            res.json({ success: true, note: "Pievienots aktīvajam darbam (mašīna nesakrita)" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "DB kļūda" });
    }
});

// --- 5. ATSKAITES ---
app.post('/api/darba-stundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        await pool.query(
            'INSERT INTO "darbastundas" (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1, $2, $3, $4, $5, $6)',
            [darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas]
        );
        res.status(200).send("OK"); // Obligāti jānosūta atbilde atpakaļ!
    } catch (err) {
        console.error("DB Kļūda:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- 5.1 ATSKAIŠU IEGŪŠANA (Adminam) ---
app.get('/api/darba-stundas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM "darbastundas" ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
