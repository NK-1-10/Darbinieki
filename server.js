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

app.get('/api/schedule', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM schedule");
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
});

// 1. Sākt darbu (Izveido jaunu ierakstu ar sākuma laiku)
app.post('/api/start-work', async (req, res) => {
  const { worker_name, car } = req.body;
  try {
    const startTime = new Date().toLocaleString('lv-LV'); // Iegūst laiku Latvijas formātā kā tekstu
    await pool.query(
      'INSERT INTO schedule (worker_name, car, start_time) VALUES ($1, $2, $3)',
      [worker_name, car, startTime]
    );
    res.json({ success: true, startTime });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// 2. Beigt darbu (Atrod pēdējo ierakstu bez beigu laika un ieraksta to)
app.post('/api/stop-work', async (req, res) => {
  const { worker_name } = req.body;
  try {
    const endTime = new Date().toLocaleString('lv-LV');
    // Atjaunina jaunāko ierakstu šim darbiniekam, kuram end_time vēl ir tukšs (NULL)
    await pool.query(
      'UPDATE schedule SET end_time = $1 WHERE worker_name = $2 AND end_time IS NULL',
      [endTime, worker_name]
    );
    res.json({ success: true, endTime });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Serveris griežas uz ${PORT}`));
