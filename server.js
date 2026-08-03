const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');

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
    // Noņemam * ja ir (auto-stop marķieris)
    const s = (start || '').replace('*', '').trim();
    const e = (end || '').replace('*', '').trim();
    const sp = s.split(':').map(Number);
    const ep = e.split(':').map(Number);
    const sh = sp[0]||0, sm = sp[1]||0, ss = sp[2]||0;
    const eh = ep[0]||0, em = ep[1]||0, es = ep[2]||0;
    let diff = (eh * 3600 + em * 60 + es) - (sh * 3600 + sm * 60 + ss);
    // Ja beigas ir pirms sākuma (pusnakts pāreja), pievieno 24h
    // Bet ja starpība > 16h, visticamāk kļūda — atgriežam 0
    if (diff < 0) diff += 86400;
    if (diff > 23 * 3600) diff = 0;
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
        // Vispirms iegūstam ieraksta datus
        const row = await pool.query("SELECT * FROM schedule WHERE id = $1", [id]);
        if (!row.rows.length) return res.status(404).json({ error: "Ieraksts netika atrasts" });
        const e = row.rows[0];

        // Ja ir degvielas/eļļas patēriņš -> atjaunojam krājumu (pieskaitām atpakaļ)
        if (e.resource_amount && e.resource_name && 
            (e.darbs === 'Degvielas uzpilde' || e.darbs === 'Eļļas papildināšana')) {
            await pool.query(
                'UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE name = $2',
                [parseFloat(e.resource_amount), e.resource_name]
            );
        }
        // Ja ir admin atņemšana -> atjaunojam atpakaļ (pieskaitām)
        if (e.resource_amount && e.resource_name && e.darbs === 'Resursu atņemšana') {
            await pool.query(
                'UPDATE resource_types SET quantity = COALESCE(quantity, 0) + $1 WHERE name = $2',
                [parseFloat(e.resource_amount), e.resource_name]
            );
        }
        // Ja ir admin papildinājums -> atjaunojam atpakaļ (atņemam)
        if (e.resource_amount && e.resource_name && e.darbs === 'Resursu papildinājums') {
            await pool.query(
                'UPDATE resource_types SET quantity = COALESCE(quantity, 0) - $1 WHERE name = $2',
                [parseFloat(e.resource_amount), e.resource_name]
            );
        }

        await pool.query("DELETE FROM schedule WHERE id = $1", [id]);
        res.json({ success: true, message: "Ieraksts izdzēsts" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Servera kļūda: " + err.message });
    }
});

// Rediģēt schedule ierakstu
app.put('/api/schedule/:id', async (req, res) => {
    const id = req.params.id;
    const { resource_amount, resource_name, mh_current, hours, darbs, objekts, car, sākuma_laiks, beigu_laiks } = req.body;
    try {
        // Iegūstam veco ierakstu
        const old = await pool.query("SELECT * FROM schedule WHERE id = $1", [id]);
        if (!old.rows.length) return res.status(404).json({ error: "Nav atrasts" });
        const e = old.rows[0];

        // Ja mainās resursu daudzums VAI nosaukums -> atjaunojam krājumu
        const oldAmt = parseFloat(e.resource_amount || 0);
        const newAmt = parseFloat(resource_amount !== undefined ? resource_amount : e.resource_amount || 0);
        const oldResName = e.resource_name;
        const newResName = resource_name !== undefined ? resource_name : oldResName;
        const resChanged = newResName !== oldResName;
        const amtChanged = oldAmt !== newAmt;
        const isConsumption = e.darbs === 'Degvielas uzpilde' || e.darbs === 'Eļļas papildināšana' || e.darbs === 'Resursu atņemšana';
        const isAddition = e.darbs === 'Resursu papildinājums';

        if ((resChanged || amtChanged) && (isConsumption || isAddition)) {
            if (resChanged) {
                // Atdodam veco resursam atpakaļ
                if (oldResName) {
                    const sign = isConsumption ? 1 : -1;
                    await pool.query('UPDATE resource_types SET quantity = COALESCE(quantity,0) + $1 WHERE name = $2', [sign * oldAmt, oldResName]);
                }
                // Atņemam no jaunā resursa
                if (newResName) {
                    const sign = isConsumption ? -1 : 1;
                    await pool.query('UPDATE resource_types SET quantity = COALESCE(quantity,0) + $1 WHERE name = $2', [sign * newAmt, newResName]);
                }
            } else {
                // Tikai daudzums mainījās
                if (isConsumption) {
                    await pool.query('UPDATE resource_types SET quantity = COALESCE(quantity,0) + $1 - $2 WHERE name = $3', [oldAmt, newAmt, oldResName]);
                } else if (isAddition) {
                    await pool.query('UPDATE resource_types SET quantity = COALESCE(quantity,0) - $1 + $2 WHERE name = $3', [oldAmt, newAmt, oldResName]);
                }
            }
        }

        // Aprēķinām jauno mh_previous ja mainās mh_current
        let newMhPrev = e.mh_previous;
        if (mh_current !== undefined && e.car) {
            const prev = await pool.query(
                'SELECT mh_current FROM schedule WHERE car = $1 AND mh_current IS NOT NULL AND id != $2 ORDER BY id DESC LIMIT 1',
                [e.car, id]
            );
            newMhPrev = prev.rows[0]?.mh_current || null;
        }

        // Ja mainās sākuma/beigu laiks → pārrēķinām stundas
        let finalHours = hours || null;
        if (sākuma_laiks && beigu_laiks) {
            const cleanEnd = beigu_laiks.replace('*', '');
            finalHours = calculateHours(sākuma_laiks, cleanEnd);
        }

        await pool.query(`
            UPDATE schedule SET
                resource_amount = COALESCE($1, resource_amount),
                resource_name = COALESCE($2, resource_name),
                mh_current = COALESCE($3, mh_current),
                mh_previous = $4,
                hours = COALESCE($5, hours),
                darbs = COALESCE($6, darbs),
                objekts = COALESCE($7, objekts),
                car = COALESCE($8, car),
                "sākuma_laiks" = COALESCE($10, "sākuma_laiks"),
                beigu_laiks = COALESCE($11, beigu_laiks)
            WHERE id = $9`,
            [resource_amount || null, resource_name || null, mh_current || null, newMhPrev, finalHours, darbs || null, objekts || null, car || null, id, sākuma_laiks || null, beigu_laiks || null]
        );

        // Automātiska darbastundas korekcija
        // Summējam visus darbus šim darbiniekam šajā datumā (ne degviela/eļļa)
        const updatedRow = await pool.query('SELECT * FROM schedule WHERE id = $1', [id]);
        if (updatedRow.rows.length > 0) {
            const row = updatedRow.rows[0];
            const workerName = row.worker_name;
            const date = row.date;

            const sumResult = await pool.query(`
                SELECT COALESCE(SUM(CAST(REPLACE(hours::text, '*', '') AS NUMERIC)), 0) as total
                FROM schedule
                WHERE worker_name = $1
                AND date = $2
                AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana', 'Resursu papildinājums', 'Resursu atņemšana')
                AND hours IS NOT NULL`,
                [workerName, date]
            );
            const scheduleTotal = parseFloat(sumResult.rows[0].total);

            // Atrodam darbastundas ierakstu šim darbiniekam šajā datumā
            const shiftRow = await pool.query(`
                SELECT id, stundas FROM "darbastundas"
                WHERE darbinieks = $1 AND datums = $2
                ORDER BY id DESC LIMIT 1`,
                [workerName, date]
            );

            if (shiftRow.rows.length > 0) {
                const currentShiftHours = parseFloat(shiftRow.rows[0].stundas || 0);
                // Ja darba gaita pārsniedz darba stundas → atjauninam
                if (scheduleTotal > currentShiftHours) {
                    await pool.query(
                        'UPDATE "darbastundas" SET stundas = $1 WHERE id = $2',
                        [scheduleTotal.toFixed(2), shiftRow.rows[0].id]
                    );
                    console.log(`📊 Darbastundas atjauninātas: ${workerName} ${date} → ${scheduleTotal.toFixed(2)}h`);
                }
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- JAUNS: Dzēst vienu ierakstu no DARBASTUNDAS ---
app.put('/api/darbastundas/:id', async (req, res) => {
    try {
        const { stundas, sāka_darbu, beidza_darbu } = req.body;
        let finalHours = parseFloat(stundas);
        if (sāka_darbu && beidza_darbu) {
            const cleanEnd = beidza_darbu.replace('*', '');
            finalHours = parseFloat(calculateHours(sāka_darbu, cleanEnd));
        }
        await pool.query(
            'UPDATE "darbastundas" SET stundas = $1, "sāka_darbu" = COALESCE($2, "sāka_darbu"), beidza_darbu = COALESCE($3, beidza_darbu) WHERE id = $4',
            [finalHours, sāka_darbu || null, beidza_darbu || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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
                needsPasswordChange: (userData.temp_password === password && userData.role !== 'viewer')
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
        const r = await pool.query("SELECT id, name, quantity, track_mh, vien FROM resource_types ORDER BY name ASC");
        console.log("has gotten "+  name, quantity, track_mh, vien, cena);
        res.json(r.rows); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/resource-types', async (req, res) => {
    const { name, quantity, track_mh, vien, cena } = req.body; // =------------------------------------------------------------------------------------------------------
    console.log(name, quantity, track_mh, vien, cena);
    try {
        await pool.query(
            'INSERT INTO resource_types (name, quantity, vien, cena) VALUES ($1, $2, $3, $4)',
            [name, quantity || 0, vien, cena]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/resource-types/:id', async (req, res) => {
    const { id } = req.params;
    const { action, amount, adminName, price_per_unit } = req.body;
    const adminLabel = adminName || 'Admin';
    const litri = parseFloat(amount) || 0;
    const gabala = price_per_unit ? parseFloat(price_per_unit) : null;
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
                `INSERT INTO schedule (worker_name, car, date, "sākuma_laiks", "beigu_laiks", month, resource_name, resource_amount, darbs, hours, gabala) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,0,$9)`,
                [ adminLabel, 'Papildinājums', datums, laiks, monthStr, resourceName, litri, 'Resursu papildinājums', gabala]
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
        const r = await pool.query("SELECT name, temp_password, role FROM users WHERE role = 'worker' OR role IS NULL ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/cars', async (req, res) => {
    try {
        const r = await pool.query("SELECT id, name, track_mh, caurlaide_lidz FROM cars ORDER BY name ASC");
        res.json(r.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/objects', async (req, res) => {
    try {
        const r = await pool.query("SELECT name, latitude, longitude, radius_m FROM objects ORDER BY name ASC");
        res.json(r.rows);
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
        const { name, track_mh, caurlaide_lidz } = req.body;
        await pool.query(
            'UPDATE cars SET name = $1, track_mh = $2, caurlaide_lidz = $3 WHERE name = $4',
            [name, track_mh !== undefined ? track_mh : false, caurlaide_lidz || null, req.params.name]
        );
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
        const { name, latitude, longitude, radius_m } = req.body;
        await pool.query(
            'UPDATE objects SET name = $1, latitude = $2, longitude = $3, radius_m = $4 WHERE name = $5',
            [name, latitude || null, longitude || null, radius_m || 200, req.params.name]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/resource-types/:name', async (req, res) => {
    try {
        const { name, track_mh } = req.body;
        if (track_mh !== undefined) {
            await pool.query('UPDATE resource_types SET name = $1, track_mh = $2 WHERE name = $3', [name, track_mh, req.params.name]);
        } else {
            await pool.query('UPDATE resource_types SET name = $1 WHERE name = $2', [name, req.params.name]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/start-work', async (req, res) => {
    const { worker_name, car, objekts, darbs } = req.body;
    // Laiku ņemam no servera, ne klienta
    const date = getTodayLV();
    const time = getTimeLV();
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
    const { worker_name } = req.body;
    // Laiku ņemam no servera, ne klienta
    const timeOnly = getTimeLV();
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
        // Iegūstam iepriekšējo mH šai mašīnai
        let mh_previous = null;
        if (req.body.mh_current != null && car) {
            const prevRow = await pool.query(
                `SELECT mh_current FROM schedule WHERE car = $1 AND mh_current IS NOT NULL ORDER BY id DESC LIMIT 1`,
                [car]
            );
            mh_previous = prevRow.rows[0]?.mh_current || null;
        }
        const mh_current = req.body.mh_current || null;

        await pool.query(`
            INSERT INTO schedule (
                worker_name, car, date, sākuma_laiks, beigu_laiks, 
                month, resource_name, resource_amount, 
                pielietā_eļļa, pielietā_degviela, darbs, hours,
                mh_current, mh_previous
            ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12)`,
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
            (type === 'Ella' ? 'Eļļas papildināšana' : 'Degvielas uzpilde'),
            mh_current,
            mh_previous
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

// Iegūt pēdējo mH konkrētai mašīnai
app.get('/api/last-mh', async (req, res) => {
    const { car } = req.query;
    try {
        const r = await pool.query(
            'SELECT mh_current FROM schedule WHERE car = $1 AND mh_current IS NOT NULL ORDER BY id DESC LIMIT 1',
            [car]
        );
        res.json({ mh: r.rows[0]?.mh_current || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

// --- IESTATĪJUMI ---
app.get('/api/settings', async (req, res) => {
    try {
        const r = await pool.query('SELECT key, value FROM settings');
        const obj = {};
        r.rows.forEach(row => obj[row.key] = row.value);
        res.json(obj);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        await pool.query(
            'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
            [key, value]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- AUTO-STOP CRON (katru minūti pārbauda laiku no DB) ---
cron.schedule('* * * * *', async () => {
    let stopTime = '00:00';
    try {
        const s = await pool.query("SELECT value FROM settings WHERE key = 'auto_stop_time'");
        if (s.rows[0]) stopTime = s.rows[0].value;
    } catch(e) {}

    const nowLV = new Date().toLocaleTimeString('lv-LV', {
        timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hour12: false
    });
    if (nowLV !== stopTime) return;

    console.log(`🕛 Auto-stop: ${stopTime} — pārbaudām aktīvos darbus...`);
    const todayLV = getTodayLV();

    try {
        const activeShifts = await pool.query(
            `SELECT * FROM "darbastundas" WHERE beidza_darbu IS NULL`
        );

        for (const shift of activeShifts.rows) {
            const workerName = shift.darbinieks;

            const activeJob = await pool.query(
                `SELECT * FROM schedule
                 WHERE worker_name = $1
                 AND beigu_laiks IS NULL
                 AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana')
                 ORDER BY id DESC LIMIT 1`,
                [workerName]
            );

            const lastFinished = await pool.query(
                `SELECT * FROM schedule
                 WHERE worker_name = $1
                 AND date = $2
                 AND beigu_laiks IS NOT NULL
                 AND REPLACE(beigu_laiks, '*', '') >= $3
                 AND REPLACE(beigu_laiks, '*', '') <= $4
                 AND darbs NOT IN ('Degvielas uzpilde', 'Eļļas papildināšana')
                 ORDER BY beigu_laiks DESC LIMIT 1`,
                [workerName, shift.datums, shift.sāka_darbu, stopTime]
            );

            if (activeJob.rows.length > 0) {
                const endMark = stopTime + '*';
                // Aktīvais darbs vienmēr 0h (netika pabeigts)
                await pool.query(
                    `UPDATE schedule SET beigu_laiks = $1, hours = $2 WHERE id = $3`,
                    [endMark, '0.00', activeJob.rows[0].id]
                );
                // Shift beigu laiks un stundas
                if (lastFinished.rows.length > 0) {
                    // Ir pabeigti darbi → beigas = pēdējā darba beigu laiks + * marķieris
                    const lastEnd = lastFinished.rows[0].beigu_laiks.replace('*','');
                    const shiftHours = calculateHours(shift.sāka_darbu, lastEnd);
                    await pool.query(
                        `UPDATE "darbastundas" SET beidza_darbu = $1, stundas = $2 WHERE id = $3`,
                        [lastEnd + '*', shiftHours, shift.id]
                    );
                } else {
                    // Nav pabeigtu darbu → 0h, beigas stopTime*
                    await pool.query(
                        `UPDATE "darbastundas" SET beidza_darbu = $1, stundas = $2 WHERE id = $3`,
                        [endMark, '0.00', shift.id]
                    );
                }
                console.log(`⛔ ${workerName}: aktīvs darbs slēgts, shift stundas: ${shiftHours}`);
            } else if (lastFinished.rows.length > 0) {
                // Nav aktīva darba, bet ir pabeigti → beigas = pēdējā darba beigu laiks
                const lastEndTime = lastFinished.rows[0].beigu_laiks.replace('*','');
                await pool.query(
                    `UPDATE "darbastundas" SET beidza_darbu = $1, stundas = $2 WHERE id = $3`,
                    [lastEndTime, calculateHours(shift.sāka_darbu, lastEndTime), shift.id]
                );
                console.log(`✅ ${workerName}: diena slēgta ar ${lastEndTime}`);
            } else {
                // Nav neviena darba → 0h, beigas stopTime*
                const endMark = stopTime + '*';
                await pool.query(
                    `UPDATE "darbastundas" SET beidza_darbu = $1, stundas = $2 WHERE id = $3`,
                    [endMark, '0.00', shift.id]
                );
                console.log(`⚠️ ${workerName}: nav darbu, diena slēgta ar 0h`);
            }
        }
    } catch (err) {
        console.error('Auto-stop kļūda:', err);
    }
}, { timezone: 'Europe/Riga' });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
