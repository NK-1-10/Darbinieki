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
});

// --- IELĀDĒT DATUS (GET) ---
app.get('/api/workers', async (req, res) => {
  try {
    const result = await pool.query("SELECT name, temp_password FROM users WHERE role = 'worker'");
    res.json(result.rows);
  } catch (err) { res.status(500).json(err.message); }
});

app.get('/api/cars', async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM cars");
    console.log("Dati no DB:", result.rows); // Šis parādīsies Railway logos
    res.json(result.rows.map(row => row.name));
  } catch (err) { 
    console.error("DB KĻŪDA:", err.message); // Šis parādīs kļūdu, ja tāda būs
    res.status(500).json({ error: err.message }); 
  }
});

// --- DARBA VEIDI ---
app.get('/api/work-types', async (req, res) => {
    try {
        const result = await pool.query("SELECT name FROM work_types ORDER BY name ASC");
        res.json(result.rows.map(row => row.name));
    } catch (err) { res.status(500).json(err.message); }
});

app.post('/api/work-types', async (req, res) => {
    try {
        await pool.query('INSERT INTO work_types (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err.message); }
});

app.delete('/api/work-types/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM work_types WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err.message); }
});

// --- OBJEKTI ---
app.get('/api/objects', async (req, res) => {
    try {
        const result = await pool.query("SELECT name FROM objects ORDER BY name ASC");
        res.json(result.rows.map(row => row.name));
    } catch (err) { res.status(500).json(err.message); }
});

app.post('/api/objects', async (req, res) => {
    try {
        await pool.query('INSERT INTO objects (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err.message); }
});

app.delete('/api/objects/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM objects WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err.message); }
});

app.get('/api/schedule', async (req, res) => {
  try {
    // Pievienojam ORDER BY id DESC, lai jaunākie dati vienmēr nāktu pirmie
    const result = await pool.query("SELECT * FROM schedule ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) { res.status(500).json(err.message); }
});

app.delete('/api/schedule', async (req, res) => {
  try {
    // Šī ir komanda, kas iztīra PostgreSQL tabulu
    await pool.query("DELETE FROM schedule");
    res.json({ success: true, message: "Tabula iztīrīta" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE name = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Lietotājs nav atrasts" });
    
    const user = result.rows[0];

    // Pārbaudām, vai ienāk ar pagaidu paroli
    if (user.temp_password && password === user.temp_password) {
      return res.json({ 
        name: user.name, 
        role: user.role, 
        needsPasswordChange: true // Frontend zinās, ka jāprasa jauna parole
      });
    } 
    
    // Pārbaudām parasto paroli
    if (user.password && password === user.password) {
      return res.json({ 
        name: user.name, 
        role: user.role, 
        needsPasswordChange: false 
      });
    }

    res.status(401).json({ error: "Nepareiza parole" });
  } catch (err) { res.status(500).json(err.message); }
});

// 2. JAUNS: Funkcija paroles maiņai
app.post('/api/change-password', async (req, res) => {
  const { username, newPassword } = req.body;
  try {
    // Iestatām jauno paroli un izdzēšam pagaidu paroli (set to NULL)
    await pool.query(
      'UPDATE users SET password = $1, temp_password = NULL WHERE name = $2',
      [newPassword, username]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json(err.message); }
});

// Pārējās tavas funkcijas paliek tādas pašas:
app.post('/api/workers', async (req, res) => {
  const { name, temp_password } = req.body;
  try {
    await pool.query('INSERT INTO users (name, temp_password, role) VALUES ($1, $2, $3)', [name, temp_password, 'worker']);
    res.json({ success: true });
  } catch (err) { res.status(500).json(err.message); }
});

app.post('/api/cars', async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('INSERT INTO cars (name) VALUES ($1)', [name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json(err.message); }
});

app.post('/api/schedule', async (req, res) => {
  const { worker_name, month, date, car, from_time, to_time, hours } = req.body;
  try {
    await pool.query(
      'INSERT INTO schedule (worker_name, month, date, car, from_time, to_time, hours) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [worker_name, month, date, car, from_time, to_time, hours]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json(err.message); }
  
});//IZDZĒST DARBINIEKU
app.delete('/api/workers/:name', async (req, res) => {
    const workerName = req.params.name;
    try {
        await pool.query('DELETE FROM users WHERE name = $1 AND role = $2', [workerName, 'worker']);
        res.json({ success: true, message: `Darbinieks ${workerName} izdzēsts.` });
    } catch (err) {
        console.error("Kļūda dzēšot darbinieku:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- DZĒST MAŠĪNU ---
app.delete('/api/cars/:name', async (req, res) => {
    const carName = req.params.name;
    try {
        await pool.query('DELETE FROM cars WHERE name = $1', [carName]);
        res.json({ success: true, message: `Mašīna ${carName} izdzēsta.` });
    } catch (err) {
        console.error("Kļūda dzēšot mašīnu:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- SĀKT DARBU ---
app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time } = req.body; 
    try {
        // start_time nāk kā "05.02.2026. 10:22:36"
        const parts = start_time.split(' ');
        const datePart = parts[0];
        const timePart = parts[1];

        // Iegūstam mēneša nosaukumu latviski
        const monthNames = ["Janvāris", "Februāris", "Marts", "Aprīlis", "Maijs", "Jūnijs",
                           "Jūlijs", "Augusts", "Septembris", "Oktobris", "Novembris", "Decembris"];
        const monthIndex = parseInt(datePart.split('.')[1]) - 1;
        const monthStr = monthNames[monthIndex];

        await pool.query(
            'INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month) VALUES ($1, $2, $3, $4, $5)',
            [worker_name, car, datePart, timePart, monthStr]
        );
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// --- BEIGT DARBU ---
app.post('/api/stop-work', async (req, res) => {
    // 1. Paņemam laiku no klienta
    const { worker_name, end_time } = req.body; 
    try {
        // Paņemam tikai laika daļu (HH:MM:SS) priekš datubāzes, ja nepieciešams
        const timePart = end_time.split(' ')[1];

        // Atrodam sākuma laiku
        const result = await pool.query(
            'SELECT sākuma_laiks FROM schedule WHERE worker_name = $1 AND beigu_laiks IS NULL',
            [worker_name]
        );

        if (result.rows.length > 0) {
            const startTimeStr = result.rows[0].sākuma_laiks;
            
            // Aprēķins
            const [startH, startM] = startTimeStr.split(':').map(Number);
            const [endH, endM] = timePart.split(':').map(Number);
            
            let totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
            
            // Ja darbs beidzas pēc pusnakts
            if (totalMinutes < 0) totalMinutes += 24 * 60;

            const diffHours = (totalMinutes / 60).toFixed(2);

            await pool.query(
                'UPDATE schedule SET beigu_laiks = $1, hours = $2 WHERE worker_name = $3 AND beigu_laiks IS NULL',
                [timePart, diffHours, worker_name]
            );
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Nav aktīva darba seanssa" });
        }
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: err.message }); 
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Serveris griežas uz ${PORT}`));
