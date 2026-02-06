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

// --- PAMATA RESURSI ---
app.get('/api/cars', async (req, res) => {
    const r = await pool.query("SELECT name FROM cars ORDER BY name");
    res.json(r.rows.map(row => row.name));
});
app.get('/api/objects', async (req, res) => {
    const r = await pool.query("SELECT name FROM objects ORDER BY name");
    res.json(r.rows.map(row => row.name));
});
app.get('/api/work-types', async (req, res) => {
    const r = await pool.query("SELECT name FROM work_types ORDER BY name");
    res.json(r.rows.map(row => row.name));
});

// --- KONKRĒTI DARBI (schedule tabula - image_92f4c6.png) ---
app.get('/api/schedule', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM schedule ORDER BY id DESC");
        res.json(result.rows);
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
            let diffSec = (eh * 3600 + em * 60 + es) - (sh * 3600 + sm * 60 + ss);
            if (diffSec < 0) diffSec += 86400;
            const hoursStr = (diffSec / 3600).toFixed(2); // Saglabājam kā tekstu "0.02"

            await pool.query(
                'UPDATE schedule SET beigu_laiks=$1, hours=$2 WHERE worker_name=$3 AND beigu_laiks IS NULL',
                [timeOnly, hoursStr, worker_name]
            );
            res.json({ success: true });
        } else { res.status(404).json({ error: "Nav aktīva seansa" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- MAIŅU UZSKAITE (darba_stundas tabula - image_934b7d.png) ---
app.post('/api/darba-stundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        await pool.query(
            'INSERT INTO darba_stundas (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1,$2,$3,$4,$5,$6)',
            [darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/darba-stundas', async (req, res) => {
    const r = await pool.query("SELECT * FROM darba_stundas ORDER BY id DESC");
    res.json(r.rows);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Serveris gatavs portā ${PORT}`));
