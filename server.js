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

// --- HELPER FUNKCIJA LAIKA APRĒĶINAM ---
function calculateHours(start, end) {
    const [sh, sm, ss] = start.split(':').map(Number);
    const [eh, em, es] = end.split(':').map(Number);
    let diff = (eh * 3600 + em * 60 + es) - (sh * 3600 + sm * 60 + ss);
    if (diff < 0) diff += 86400; // Ja darbs beidzas pēc pusnakts
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

// --- 4. DARBA GAITA (SVARĪGĀKIE LABOJUMI ŠEIT) ---

// SĀKT DARBU: Pievienota pārbaude, lai nevarētu sākt divus darbus vienlaicīgi
app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body;
    const parts = start_time.split(' '); 
    const date = parts[0];
    const time = parts[1];
    
    try {
        // 1. PĀRBAUDE: Vai šim darbiniekam jau nav nepabeigts darbs?
        const activeCheck = await pool.query(
            "SELECT id FROM schedule WHERE worker_name = $1 AND beigu_laiks IS NULL AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana')",
            [worker_name]
        );

        if (activeCheck.rows.length > 0) {
            return res.status(400).json({ error: "Jums jau ir aktīvs darbs! Lūdzu, vispirms pabeidziet to." });
        }

        const tagad = new Date();
        const monthRaw = tagad.toLocaleDateString('lv-LV', { month: 'long' });
        const monthStr = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);

        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [worker_name, car, date, time, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// BEIGT DARBU: Precīzāka meklēšana un stundu aprēķins
app.post('/api/stop-work', async (req, res) => {
    const { worker_name, end_time } = req.body;
    const timeOnly = end_time.split(' ')[1];

    try {
        // Atrodam pēdējo atvērto darba ierakstu
        const active = await pool.query(`
            SELECT id, sākuma_laiks 
            FROM schedule 
            WHERE worker_name=$1 
            AND beigu_laiks IS NULL 
            AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana')
            ORDER BY id DESC LIMIT 1
        `, [worker_name]);

        if (active.rows.length > 0) {
            const rowId = active.rows[0].id;
            const startTime = active.rows[0].sākuma_laiks;
            const hoursStr = calculateHours(startTime, timeOnly);

            await pool.query(
                'UPDATE schedule SET beigu_laiks=$1, hours=$2 WHERE id=$3',
                [timeOnly, hoursStr, rowId]
            );
            res.json({ success: true, hours: hoursStr });
        } else { 
            res.status(404).json({ error: "Nav aktīva darba, ko pabeigt." }); 
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// RESURSU PAPILDINĀŠANA: Tagad tie tiek atzīmēti kā 0 stundas, lai nebojātu kopējo laiku
app.post('/api/update-resources', async (req, res) => {
    const { worker_name, car, resource_name, resource_amount, type } = req.body;
    
    const tagad = new Date();
    const datums = tagad.toLocaleDateString('lv-LV', { timeZone: 'Europe/Riga' });
    const laiks = tagad.toLocaleTimeString('lv-LV', { 
        timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
    });

    const monthRaw = tagad.toLocaleDateString('lv-LV', { month: 'long', timeZone: 'Europe/Riga' });
    const monthStr = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);

    try {
        await pool.query(`
            INSERT INTO schedule 
            (worker_name, car, date, sākuma_laiks, beigu_laiks, month, resource_name, resource_amount, 
             pielietā_eļļa, pielietā_degviela, darbs, hours) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0)`, 
        [
            worker_name, car, datums, laiks, laiks, 
            monthStr, resource_name, resource_amount, 
            (type === 'Ella' ? resource_amount : null),
            (type === 'Degviela' ? resource_amount : null),
            (type === 'Ella' ? 'Eļļas papildināšana' : 'Degvielas uzpilde')
        ]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Servera kļūda" }); }
});

// ... Pārējās sadaļas (GET workers, cars, objects) paliek nemainīgas ...

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
