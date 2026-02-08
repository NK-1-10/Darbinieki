const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json()); // Atļauj serverim saprast JSON datus, ko sūta fronts
app.use(cors()); // Atļauj piekļuvi no dažādiem domēniem (noderīgi izstrādes laikā)
app.use(express.static(path.join(__dirname, '.'))); // Norāda, ka visas HTML/JS datnes atrodas šajā mapē

// Pieslēgšanās datubāzei, izmantojot vidē definēto mainīgo (Render vai lokāli)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Nepieciešams lielākajai daļai mākkoņpakalpojumu (piem. Render)
});

// --- 1. IELOGOŠANĀS (LOGIN) ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; // Paņemam datus no ielogošanās formas

    try {
        // SQL: Meklējam lietotāju pēc vārda un pārbaudām vai parole sakrīt ar pamata vai pagaidu paroli
        const query = `
            SELECT * FROM users 
            WHERE name = $1 AND (password = $2 OR temp_password = $2)
        `;

        const result = await pool.query(query, [username, password]);

        if (result.rows.length > 0) {
            const userData = result.rows[0];
            
            // Pārbaudām, vai ielogojās ar pagaidu paroli (tad pēc tam liksim mainīt)
            const needsPasswordChange = (userData.temp_password === password);

            // Sagatavojam datus sūtīšanai atpakaļ uz pārlūku
            const userResponse = {
                id: userData.id,
                name: userData.name,
                role: userData.role || "worker", // Ja loma nav norādīta, piešķiram parasto darbinieku
                needsPasswordChange: needsPasswordChange
            };

            console.log("✅ Ielogošanās veiksmīga:", userResponse.name);
            res.json(userResponse); 
        } else {
            // Ja lietotājs nav atrasts vai parole nepareiza
            res.status(401).json({ success: false, error: "Nepareizs vārds vai parole" });
        }
    } catch (err) {
        console.error("DB Kļūda:", err.message);
        res.status(500).json({ success: false, error: "Servera kļūda" });
    }
});

// --- JAUNS: Paroles maiņa (kad darbinieks nomaina pagaidu paroli uz savu) ---
app.post('/api/change-password', async (req, res) => {
    const { username, newPassword } = req.body;
    try {
        // UPDATE: Ierakstām jauno paroli un izdzēšam pagaidu paroli (uzliekam NULL)
        await pool.query(
            'UPDATE users SET password = $1, temp_password = NULL WHERE name = $2',
            [newPassword, username]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 2. PAMATA DATU IEGŪŠANA (Sarakstiem select lodziņos) ---
app.get('/api/cars', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM cars ORDER BY name ASC");
        res.json(r.rows.map(row => row.name)); // Atgriežam tikai vārdu sarakstu kā masīvu
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

// --- 3. DARBA GAITA (SCHEDULE TABULA) ---

// Iegūt visu grafiku (priekš admin paneļa)
app.get('/api/schedule', async (req, res) => {
    try {
        const r = await pool.query("SELECT * FROM schedule ORDER BY id DESC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kad darbinieks nospiež "Sākt darbu"
app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body;
    
    // Sadalām saņemto laiku ("08.02.2026 14:00:00") datumā un laikā
    const [date, time] = start_time.split(' ');
    
    // Aprēķinām mēneša nosaukumu latviski, lai admin panelī būtu vieglāk filtrēt
    const months = ["Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs","Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"];
    const monthIndex = parseInt(date.split('.')[1]) - 1; // Mēneši masīvā sākas no 0
    const monthStr = months[monthIndex];
    
    try {
        // Ievietojam jaunu ierakstu ar sākuma laiku, bet BEIGU laiks vēl ir tukšs (NULL)
        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [worker_name, car, date, time, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kad darbinieks nospiež "Beigt darbu" (ar mašīnu)
app.post('/api/stop-work', async (req, res) => {
    const { worker_name, end_time } = req.body;
    const timeOnly = end_time.split(' ')[1]; // Paņemam tikai HH:MM:SS daļu

    try {
        // 1. Atrodam ierakstu, kuram šim darbiniekam vēl nav beigu laika
        const active = await pool.query('SELECT sākuma_laiks FROM schedule WHERE worker_name=$1 AND beigu_laiks IS NULL', [worker_name]);
        
        if (active.rows.length > 0) {
            const start = active.rows[0].sākuma_laiks;
            
            // 2. Aprēķinām nostrādātās stundas
            const [sh, sm, ss] = start.split(':').map(Number); // Sākuma stundas, minūtes
            const [eh, em, es] = timeOnly.split(':').map(Number); // Beigu stundas, minūtes
            
            // Pārvēršam visu sekundēs, lai vieglāk izrēķināt starpību
            let diff = (eh * 3600 + em * 60 + es) - (sh * 3600 + sm * 60 + ss);
            if (diff < 0) diff += 86400; // Ja darbs beidzas pēc pusnakts
            
            const hoursStr = (diff / 3600).toFixed(2); // Pārvēršam atpakaļ uz stundām (piem. 1.50 h)

            // 3. Saglabājam beigu laiku un kopējās stundas
            await pool.query(
                'UPDATE schedule SET beigu_laiks=$1, hours=$2 WHERE worker_name=$3 AND beigu_laiks IS NULL',
                [timeOnly, hoursStr, worker_name]
            );
            res.json({ success: true });
        } else { 
            res.status(404).json({ error: "Nav aktīva darba" }); 
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. ATSKAITES (Kad darbinieks nospiež "Dodos mājās") ---
app.post('/api/darba-stundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        // Ievietojam datus tabulā "DarbaStundas" (šeit glabājas tikai dienas kopsummas)
        // Piezīme: "DarbaStundas" ir pēdiņās, jo nosaukumā ir lielie burti (Postgres to prasa)
        await pool.query(
            'INSERT INTO "DarbaStundas" (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1,$2,$3,$4,$5,$6)',
            [darbinieks, datums, sāka_darbu, beidza_darbu, month, parseFloat(stundas) || 0]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Atskaites kļūda:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Servera palaišana uz norādītā porta
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
