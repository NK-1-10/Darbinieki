<!DOCTYPE html>
<html lang="lv">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="admin.png?v=2">
    <title>Admin Panelis</title>
    <link rel="stylesheet" href="adminCSS.css">
</head>
<body>

    <div class="sidebar">
        <button id="toggle-btn" onclick="toggleSidebar()">&#9776;</button>
        <div class="sidebar-header">
            <h2 class="Admin-head">SIA Admin</h2>
        </div>

        <div class="nav-group">
            <div class="nav-label">Iestatījumi</div>
            <div class="nav-item active" onclick="showView('v-workers', this)"><i>👷</i><span>Darbinieki</span></div>
            <div class="nav-item" onclick="showView('v-cars', this)"><i>🚗</i><span>Mašīnas</span></div>
            <div class="nav-item" onclick="showView('v-worktypes', this)"><i>⚒️</i><span>Darba veidi</span></div>
            <div class="nav-item" onclick="showView('v-objects', this)"><i>📍</i><span>Objekti</span></div>
            <div class="nav-item" onclick="showView('v-res', this)"><i>🛢️</i><span>Resursi</span></div>
        </div>

        <div class="nav-group">
            <div class="nav-label">Atskaites</div>
            <div class="nav-item" onclick="showView('v-report-work', this)"><i>📋</i><span>Darba gaita</span></div>
            <div class="nav-item" onclick="showView('v-report-fuel', this)"><i>⛽</i><span>Patēriņš</span></div>
            <div class="nav-item" onclick="showView('v-report-hours', this)"><i>⏱️</i><span>Darba stundas</span></div>
        </div>

        <div class="sidebar-footer">
            <button class="editadmin" onclick="openAdminModal()"><span>Rediģēt admin</span></button>
            <button class="btn-all-delete" onclick="deleteAllData()">⚠️ <span>DZĒST VISUS DATUS</span></button>
            <button class="btn-logout" onclick="logout()">
                <i>🚪</i><span class="logout-text">Iziet</span>
            </button>
        </div>
    </div>

    <div class="main-content">
        <header>
            <h3 id="current-view-title">Darbinieki</h3>
        </header>

        <main>
            <section id="v-workers" class="view-section active">
                <div class="card">
                    <button class="btn-add" onclick="addNewWorker()">+ Pievienot darbinieku</button>
                    <ul id="workerList"></ul>
                </div>
            </section>
            
            </main>
    </div>

    <div id="adminEditModal" class="modal" style="display:none;">
        <div class="modal-content">
            <h3>Admin iestatījumi</h3>
            <div class="input-group">
                <label>Jaunais lietotājvārds:</label>
                <input type="text" id="adminNewName" placeholder="Atstāj tukšu, ja nemaini">
            </div>
            <div class="input-group">
                <label>Jaunā parole:</label>
                <input type="password" id="adminNewPass" placeholder="Jaunā parole">
            </div>
            <div class="modal-buttons">
                <button onclick="closeAdminModal()" class="btn-cancel">Atcelt</button>
                <button onclick="saveAdminSettings()" class="btn-save">Saglabāt</button>
            </div>
            <hr>
            <h4>Pievienot jaunu Adminu</h4>
            <button onclick="addNewAdmin()" class="btn-add" style="width: 100%;">+ Izveidot administratoru</button>
        </div>
    </div>

    <div id="editModal" class="modal" style="display:none;">
        <div class="modal-content">
            <h3>Rediģēt darbinieku</h3>
            <div class="input-group">
                <label>Vārds Uzvārds:</label>
                <input type="text" id="editName">
            </div>
            <div class="input-group">
                <label>Pagaidu parole:</label>
                <input type="text" id="editTempPass">
            </div>
            <div class="input-group">
                <label>Jauna pastāvīgā parole:</label>
                <input type="password" id="editPass" placeholder="Ievadiet, lai mainītu">
            </div>
            <div class="modal-buttons">
                <button onclick="closeEditModal()" class="btn-cancel">Atcelt</button>
                <button onclick="saveWorkerEdit()" class="btn-save">Saglabāt</button>
            </div>
        </div>
    </div>

    <script>
        let workers = [], cars = [], schedule = [], workTypes = [], objects = [], daySummary = [], resourceTypes = [];
        const LV_MONTHS = ["Janvāris", "Februāris", "Marts", "Aprīlis", "Maijs", "Jūnijs", "Jūlijs", "Augusts", "Septembris", "Oktobris", "Novembris", "Decembris"];
        
        // Globālais ID administratoram, kuru rediģējam (parasti iegūst no sesijas)
        let currentEditingAdminId = 2; 

        function toggleSidebar() {
            document.querySelector('.sidebar').classList.toggle('collapsed');
        }

        function showView(viewId, el) {
            document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.getElementById(viewId).classList.add('active');
            el.classList.add('active');
            document.getElementById('current-view-title').innerText = el.querySelector('span').innerText;
        }

        async function loadData() {
            try {
                const endpoints = ['/api/workers', '/api/cars', '/api/schedule', '/api/work-types', '/api/objects', '/api/darbastundas', '/api/resource-types'];
                const responses = await Promise.all(endpoints.map(url => fetch(url)));
                const results = await Promise.all(responses.map(r => r.ok ? r.json() : []));

                [workers, cars, schedule, workTypes, objects, daySummary, resourceTypes] = results;
                
                updateFilterOptions();
                renderLists();
                renderTables();
            } catch (err) { 
                console.error("Datu ielādes kļūda:", err); 
            }
        }

        // --- ADMIN FUNKCIJAS ---
        function openAdminModal() {
            document.getElementById('adminEditModal').style.display = 'flex';
        }

        function closeAdminModal() {
            document.getElementById('adminEditModal').style.display = 'none';
        }

        async function saveAdminSettings() {
            const newName = document.getElementById('adminNewName').value;
            const newPass = document.getElementById('adminNewPass').value;

            if (!newName && !newPass) return alert("Nav ievadītas izmaiņas!");

            try {
                const response = await fetch(`/api/workers/id/${currentEditingAdminId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newName, password: newPass })
                });

                if (response.ok) {
                    alert("Admin dati atjaunoti!");
                    location.reload();
                }
            } catch (err) { console.error(err); }
        }

        // --- DARBINIEKU FUNKCIJAS ---
        let editingWorkerOriginalName = "";

        function openEditModal(name, tempPass) {
            editingWorkerOriginalName = name;
            document.getElementById('editName').value = name;
            document.getElementById('editTempPass').value = tempPass || "";
            document.getElementById('editPass').value = "";
            document.getElementById('editModal').style.display = 'flex';
        }

        async function saveWorkerEdit() {
            const updatedData = {
                newName: document.getElementById('editName').value,
                temp_password: document.getElementById('editTempPass').value,
                password: document.getElementById('editPass').value
            };

            try {
                const response = await fetch(`/api/workers/${encodeURIComponent(editingWorkerOriginalName)}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(updatedData)
                });

                if (response.ok) {
                    closeEditModal();
                    loadData();
                }
            } catch (err) { console.error(err); }
        }

        function closeEditModal() {
            document.getElementById('editModal').style.display = 'none';
        }

        // --- STANDARTA CRUD ---
        async function addNewItem(url, msg, extra={}) {
            const n = prompt(msg);
            if(!n) return;
            await fetch(url, {
                method:'POST', 
                headers:{'Content-Type':'application/json'}, 
                body:JSON.stringify({name:n, ...extra})
            });
            loadData();
        }

        async function deleteItem(url, name) {
            if(confirm(`Dzēst ${name}?`)) {
                await fetch(`${url}/${encodeURIComponent(name)}`, {method:'DELETE'});
                loadData();
            }
        }

        function logout() {
            localStorage.clear();
            window.location.href = 'index.html';
        }

        // Inicializācija
        loadData();
    </script>
</body>
</html>
