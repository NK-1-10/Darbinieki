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

// LOGIN loģika
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

// Pievienot darbinieku
app.post('/api/workers', async (req, res) => {
  const { name, temp_password } = req.body;
  try {
    await pool.query('INSERT INTO users (name, temp_password, role) VALUES ($1, $2, $3)', [name, temp_password, 'worker']);
    res.json({ success: true });
  } catch (err) { res.status(500).json(err.message); }
});

// Pievienot mašīnu
app.post('/api/cars', async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('INSERT INTO cars (name) VALUES ($1)', [name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json(err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveris griežas uz ${PORT}`));
