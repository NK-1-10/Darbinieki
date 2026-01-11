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
    res.json(result.rows.map(row => row.name));
  } catch (err) { res.status(500).json(err.message); }
});

app.get('/api/schedule', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM schedule");
    res.json(result.rows);
  } catch (err) { res.status(500).json(err.message); }
});

// --- SAGLABĀT DATUS (POST) ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE name = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Lietotājs nav atrasts" });
    const user = result.rows[0];
    if (password === user.password || password === user.temp_password) {
      return res.json({ name: user.name, role: user.role });
    }
    res.status(401).json({ error: "Nepareiza parole" });
  } catch (err) { res.status(500).json(err.message); }
});

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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Serveris griežas uz ${PORT}`));
