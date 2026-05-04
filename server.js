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

// Atjaunināt darbinieka datus (Vārdu un paroles)
app.put('/api/workers/:originalName', async (req, res) => {
    const { originalName } = req.params; // Vecais vārds, pēc kura atrodam ierakstu
    const { newName, temp_password, password } = req.body;

    try {
        // SQL pieprasījums: atjaunojam vārdu, pagaidu paroli un īsto paroli (ja tāda ir)
        // Ja jauna pastāvīgā parole nav ievadīta, atstājam veco
        const query = `
            UPDATE users 
            SET name = $1, 
                temp_password = $2, 
                password = COALESCE(NULLIF($3, ''), password)
            WHERE name = $4
            RETURNING *`;

        const result = await pool.query(query, [newName, temp_password, password, originalName]);

        if (result.rowCount > 0) {
            res.json({ success: true, message: "Darbinieka dati atjaunoti" });
        } else {
            res.status(404).json({ error: "Darbinieks netika atrasts" });
        }
    } catch (err) {
        console.error("Servera kļūda:", err);
        res.status(500).json({ error: "Neizdevās saglabāt izmaiņas: " + err.message });
    }
});

// --- PALĪGFUNKCIJA LAIKA STARPĪBAI ---
function calculateHours(start, end) {
    const [sh, sm, ss] = start.split(':').map(Number);
    const [eh, em, es] = end.split(':').map(Number);
    let diff = (eh * 3600 + em * 60 + es) - (sh * 3600 + sm * 60 + ss);
    if (diff < 0) diff += 86400; 
    return (diff / 3600).toFixed(2);
}

function getTodayLV() {
    return new Date().toLocaleDateString('lv-LV', { timeZone: 'Europe/Riga' });
}

function getTimeLV() {
    return new Date().toLocaleTimeString('lv-LV', {
        timeZone: 'Europe/Riga',
        hour12: false
    });
}

function getMonthLV() {
    return new Date()
        .toLocaleDateString('lv-LV', { timeZone: 'Europe/Riga', month: 'long' })
        .replace(/^\w/, c => c.toUpperCase());
}

// Iztīrīt visu tabulu pilnībā — JĀBŪT PIRMS /:id !
app.delete('/api/schedule/all', async (req, res) => {
    try {
        await pool.query("DELETE FROM schedule");
        res.json({ success: true, message: "Tabula pilnībā iztīrīta" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Neizdevās izdzēst visu: " + err.message });
    }
});

app.delete('/api/schedule/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query("DELETE FROM schedule WHERE id = $1", [id]);
        if (result.rowCount > 0) {
            res.json({ success: true, message: "Ieraksts izdzēsts" });
        } else {
            res.status(404).json({ error: "Ieraksts netika atrasts" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Servera kļūda: " + err.message });
    }
});

// --- JAUNS: Dzēst vienu ierakstu no DARBASTUNDAS ---
app.delete('/api/darbastundas/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query('DELETE FROM "darbastundas" WHERE id = $1', [id]);
        if (result.rowCount > 0) {
            res.json({ success: true, message: "Stundu ieraksts izdzēsts" });
        } else {
            res.status(404).json({ error: "Ieraksts netika atrasts" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Servera kļūda: " + err.message });
    }
});

app.delete('/api/fuel-logs', async (req, res) => {
    try { 
        // Šis izdzēsīs tikai degvielas/eļļas ierakstus no kopējā saraksta
        await pool.query("DELETE FROM schedule WHERE darbs IN ('Degvielas uzpilde', 'Eļļas papildināšana')"); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Pievieno šo pie pārējiem DELETE maršrutiem
app.delete('/api/darbastundas', async (req, res) => {
    try { 
        await pool.query('DELETE FROM "darbastundas"'); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// Nullot visu resursu daudzumus (bet saglabāt veidus)
app.post('/api/resources/reset', async (req, res) => {
    try {
        await pool.query('UPDATE resource_types SET quantity = 0');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

app.post('/api/change-password', async (req, res) => {
    const { username, newPassword } = req.body;
    try {
        await pool.query('UPDATE users SET password = $1, temp_password = NULL WHERE name = $2', [newPassword, username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. RESURSU PĀRVALDĪBA ---
app.get('/api/resource-types', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name, quantity FROM resource_types ORDER BY name ASC");
        res.json(r.rows); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/resource-types/:id', async (req, res) => {
    const { id } = req.params;
    const { action, amount, adminName } = req.body;
    const adminLabel = adminName || 'Admin';
    const litri = parseFloat(amount) || 0;
    try {
        if (action === 'sub') {
            await pool.query('UPDATE resource_types SET quantity = COALESCE(quantity, 0) - $1 WHERE id = $2', [litri, id]);

            // Ierakstām atņemšanu schedule tabulā
            const resResultSub = await pool.query('SELECT name FROM resource_types WHERE id = $1', [id]);
            const resourceNameSub = resResultSub.rows[0]?.name || 'Nezināms';

            const tagadSub = new Date();
            const optsSub = { timeZone: 'Europe/Riga' };
            const datumsSub = tagadSub.toLocaleDateString('lv-LV', optsSub);
            const laiksSub = tagadSub.toLocaleTimeString('lv-LV', { ...optsSub, hour12: false });
            const monthStrSub = tagadSub.toLocaleDateString('lv-LV', { ...optsSub, month: 'long' }).replace(/^\w/, c => c.toUpperCase());

            await pool.query(
                `INSERT INTO schedule (worker_name, car, date, "sākuma_laiks", "beigu_laiks", month, resource_name, resource_amount, darbs, hours) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,0)`,
                [ adminLabel, 'Atņemšana', datumsSub, laiksSub, monthStrSub, resourceNameSub, litri, 'Resursu atņemšana']
            );
        } else if (action === 'add') {
            await pool.query('UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE id = $2', [litri, id]);

            // Ierakstām papildinājumu schedule tabulā, lai redzams Patēriņš atskaitē
            const resResult = await pool.query('SELECT name FROM resource_types WHERE id = $1', [id]);
            const resourceName = resResult.rows[0]?.name || 'Nezināms';

            const tagad = new Date();
            const opts = { timeZone: 'Europe/Riga' };
            const datums = tagad.toLocaleDateString('lv-LV', opts);
            const laiks = tagad.toLocaleTimeString('lv-LV', { ...opts, hour12: false });
            const monthStr = tagad.toLocaleDateString('lv-LV', { ...opts, month: 'long' }).replace(/^\w/, c => c.toUpperCase());

            await pool.query(
                `INSERT INTO schedule (worker_name, car, date, "sākuma_laiks", "beigu_laiks", month, resource_name, resource_amount, darbs, hours) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,0)`,
                [ adminLabel, 'Papildinājums', datums, laiks, monthStr, resourceName, litri, 'Resursu papildinājums']
            );
        } else {
            await pool.query('UPDATE resource_types SET quantity = $1 WHERE id = $2', [litri, id]);
        }
        res.json({ success: true });
    } catch (err) { console.error('PATCH resource-types kļūda:', err.message); res.status(500).json({ error: err.message }); }
});

// --- 3. DARBINIEKI, AUTO, OBJEKTI ---
app.get('/api/workers', async (req, res) => {
    try {
        // Atlasām vārdu un pagaidu paroli, lai admins varētu to pateikt darbiniekam
        const r = await pool.query("SELECT name, temp_password, role FROM users WHERE role != 'admin' OR role IS NULL ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/cars', async (req, res) => {
    try {
        const r = await pool.query("SELECT name FROM cars ORDER BY name ASC");
        res.json(r.rows.map(row => row.name));
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

// --- 4. DARBA GAITA (SCHEDULE) ---
app.get('/api/schedule', async (req, res) => {
    const { worker_name } = req.query;
    try {
        let query = 'SELECT * FROM schedule';
        let params = [];
        if (worker_name) {
            query += ' WHERE LOWER(worker_name) = LOWER($1)';
            params.push(worker_name);
        }
        query += ' ORDER BY id DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: JAUNU VIENĪBU PIEVIENOŠANA ---

app.post('/api/workers', async (req, res) => {
    const { name, temp_password, role } = req.body;
    try {
        const query = 'INSERT INTO users (name, temp_password, role) VALUES ($1, $2, $3) RETURNING *';
        const values = [name, temp_password, role || 'worker'];
        await pool.query(query, values);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Neizdevās pievienot darbinieku (iespējams, vārds jau eksistē)" });
    }
});

app.post('/api/cars', async (req, res) => {
    try {
        await pool.query('INSERT INTO cars (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/work-types', async (req, res) => {
    try {
        await pool.query('INSERT INTO work_types (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/objects', async (req, res) => {
    try {
        await pool.query('INSERT INTO objects (name) VALUES ($1)', [req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/resource-types', async (req, res) => {
    const { name, quantity } = req.body;
    try {
        await pool.query('INSERT INTO resource_types (name, quantity) VALUES ($1, $2)', [name, quantity || 0]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN: KRĀJUMU PAPILDINĀŠANA (Poga OK) ---

app.post('/api/resource-stock', async (req, res) => {
    const { name, change } = req.body; // change var būt pozitīvs (pievienot) vai negatīvs (noņemt)
    try {
        const result = await pool.query(
            'UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE name = $2 RETURNING *',
            [parseFloat(change), name]
        );
        if (result.rowCount > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Resurss nav atrasts" });
        }
    } catch (err) { res.status(500).json({ error: "DB kļūda" }); }
});

// --- ADMIN: DZĒŠANAS FUNKCIJAS ---

app.delete('/api/cars/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM cars WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/objects/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM objects WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/work-types/:name', async (req, res) => {
    try {
        await pool.query('DELETE FROM work_types WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/resource-types/:name', async (req, res) => {
    try {
        // Vispirms iegūstam atlikušo daudzumu
        const existing = await pool.query('SELECT quantity FROM resource_types WHERE name = $1', [req.params.name]);
        const remainingQty = existing.rows[0] ? parseFloat(existing.rows[0].quantity || 0) : 0;

        // Ja ir atlikums, ierakstām atņemšanu schedule tabulā, lai kopsummas sakristu
        if (remainingQty > 0) {
            const now = new Date();
            const o = { timeZone: 'Europe/Riga' };
            const dat = now.toLocaleDateString('lv-LV', o);
            const tim = now.toLocaleTimeString('lv-LV', { ...o, hour12: false });
            const mon = now.toLocaleDateString('lv-LV', { ...o, month: 'long' }).replace(/^\w/, c => c.toUpperCase());

            await pool.query(
                `INSERT INTO schedule (worker_name, car, date, "sākuma_laiks", "beigu_laiks", month, resource_name, resource_amount, darbs, hours) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,0)`,
                ['Admin', 'Atņemšana', dat, tim, mon, req.params.name, remainingQty, 'Resursu atņemšana']
            );
        }

        await pool.query('DELETE FROM resource_types WHERE name = $1', [req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/workers/:name', async (req, res) => {
    const name = req.params.name;
    try {
        await pool.query("DELETE FROM users WHERE name = $1", [name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// (Pievieno līdzīgus delete maršrutus cars, objects un work-types)

// --- PUT (REDIĢĒT) MARŠRUTI ---
app.put('/api/cars/:name', async (req, res) => {
    try {
        await pool.query('UPDATE cars SET name = $1 WHERE name = $2', [req.body.name, req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/work-types/:name', async (req, res) => {
    try {
        await pool.query('UPDATE work_types SET name = $1 WHERE name = $2', [req.body.name, req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/objects/:name', async (req, res) => {
    try {
        await pool.query('UPDATE objects SET name = $1 WHERE name = $2', [req.body.name, req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/resource-types/:name', async (req, res) => {
    try {
        await pool.query('UPDATE resource_types SET name = $1 WHERE name = $2', [req.body.name, req.params.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, start_time, objekts, darbs } = req.body;
    const [date, time] = start_time.split(' ');
    try {
        const shiftCheck = await pool.query(
            `SELECT id FROM "darbastundas"
             WHERE darbinieks = $1
             AND beidza_darbu IS NULL
             LIMIT 1`,
            [worker_name]
        );

        if (shiftCheck.rows.length === 0) {
            return res.status(400).json({ error: "Vispirms jāsāk darba diena!" });
        }

        const activeCheck = await pool.query(
            "SELECT id FROM schedule WHERE worker_name = $1 AND beigu_laiks IS NULL AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana')",
            [worker_name]
        );
        if (activeCheck.rows.length > 0) return res.status(400).json({ error: "Aktīva sesija jau eksistē!" });

        const tagad = new Date();
        const monthStr = tagad.toLocaleDateString('lv-LV', { month: 'long' }).replace(/^\w/, c => c.toUpperCase());

        await pool.query(
            `INSERT INTO schedule (worker_name, car, date, sākuma_laiks, month, objekts, darbs) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [worker_name, car, date, time, monthStr, objekts, darbs]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stop-work', async (req, res) => {
    const { worker_name, end_time } = req.body;
    const timeOnly = end_time.split(' ')[1];
    try {
        const active = await pool.query(
            "SELECT id, sākuma_laiks FROM schedule WHERE worker_name=$1 AND beigu_laiks IS NULL AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana') ORDER BY id DESC LIMIT 1",
            [worker_name]
        );
        if (active.rows.length > 0) {
            const rowId = active.rows[0].id;
            const hoursStr = calculateHours(active.rows[0].sākuma_laiks, timeOnly);
            await pool.query('UPDATE schedule SET beigu_laiks=$1, hours=$2 WHERE id=$3', [timeOnly, hoursStr, rowId]);
            res.json({ success: true });
        } else { res.status(404).json({ error: "Nav aktīva darba." }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-resources', async (req, res) => {
    const { worker_name, car, resource_name, resource_amount, type } = req.body;
    
    const tagad = new Date();
    const opts = { timeZone: 'Europe/Riga' };
    const datums = tagad.toLocaleDateString('lv-LV', opts);
    const laiks = tagad.toLocaleTimeString('lv-LV', { ...opts, hour12: false });
    const monthStr = tagad.toLocaleDateString('lv-LV', { ...opts, month: 'long' }).replace(/^\w/, c => c.toUpperCase());

    try {
        // 1. IERAKSTĀM VĒSTURĒ (Schedule tabulā)
        await pool.query(`
            INSERT INTO schedule (
                worker_name, car, date, sākuma_laiks, beigu_laiks, 
                month, resource_name, resource_amount, 
                pielietā_eļļa, pielietā_degviela, darbs, hours
            ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 0)`,
        [
            worker_name, 
            car, 
            datums, 
            laiks, 
            monthStr, 
            resource_name, 
            resource_amount, 
            (type === 'Ella' ? resource_amount : null), 
            (type === 'Degviela' ? resource_amount : null), 
            (type === 'Ella' ? 'Eļļas papildināšana' : 'Degvielas uzpilde')
        ]);

        // 2. ATŅEMAM NO NOLIKTAVAS (resource_types tabulā)
        await pool.query(
            'UPDATE resource_types SET quantity = COALESCE(quantity, 0) - $1 WHERE name = $2',
            [parseFloat(resource_amount), resource_name]
        );

        // Tikai tagad sūtām atbildi, kad abas darbības veiksmīgas
        res.json({ success: true });

    } catch (err) {
        console.error("Resursu atjaunošanas kļūda:", err);
        res.status(500).json({ error: "Servera kļūda saglabājot datus" });
    }
});

// --- DARBA DIENAS STATUSS ---
app.get('/api/shift-status', async (req, res) => {
    const { worker_name } = req.query;

    try {
        const result = await pool.query(
            `SELECT * FROM "darbastundas"
             WHERE darbinieks = $1
             AND beidza_darbu IS NULL
             ORDER BY id DESC
             LIMIT 1`,
            [worker_name]
        );

        res.json({
            active: result.rows.length > 0,
            shift: result.rows[0] || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/start-shift', async (req, res) => {
    const { worker_name } = req.body;

    try {
        const active = await pool.query(
            `SELECT id FROM "darbastundas"
             WHERE darbinieks = $1
             AND beidza_darbu IS NULL
             LIMIT 1`,
            [worker_name]
        );

        if (active.rows.length > 0) {
            return res.status(400).json({ error: "Darba diena jau ir sākta!" });
        }

        await pool.query(
            `INSERT INTO "darbastundas"
             (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas)
             VALUES ($1, $2, $3, NULL, $4, NULL)`,
            [worker_name, getTodayLV(), getTimeLV(), getMonthLV()]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stop-shift', async (req, res) => {
    const { worker_name } = req.body;

    try {
        const active = await pool.query(
            `SELECT id, sāka_darbu FROM "darbastundas"
             WHERE darbinieks = $1
             AND beidza_darbu IS NULL
             ORDER BY id DESC
             LIMIT 1`,
            [worker_name]
        );

        if (active.rows.length === 0) {
            return res.status(404).json({ error: "Nav aktīvas darba dienas." });
        }

        const endTime = getTimeLV();
        const hours = calculateHours(active.rows[0].sāka_darbu, endTime);

        await pool.query(
            `UPDATE "darbastundas"
             SET beidza_darbu = $1,
                 stundas = $2
             WHERE id = $3`,
            [endTime, hours, active.rows[0].id]
        );

        res.json({ success: true, hours });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. DARBA STUNDAS ---
app.get('/api/darbastundas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM "darbastundas" ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/darbastundas', async (req, res) => {
    const { darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas } = req.body;
    try {
        await pool.query('INSERT INTO "darbastundas" (darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas) VALUES ($1, $2, $3, $4, $5, $6)', [darbinieks, datums, sāka_darbu, beidza_darbu, month, stundas]);
        res.status(200).send("OK");
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 6. IZTĪRĪŠANA ---
app.delete('/api/schedule', async (req, res) => {
    try { await pool.query('DELETE FROM schedule'); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
