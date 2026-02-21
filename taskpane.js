/* global Office, Word */

let generalCompleted = false;

// EXPOSICIÓN GLOBAL PARA EL HTML
window.showView = function(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    
    if (viewId === 'view-menu') clippieSay("Panel principal listo.");
};

window.checkGeneralStatus = function() {
    const fields = ['projName', 'propNumber', 'verNum', 'verDesc'];
    const values = fields.map(id => document.getElementById(id).value.trim());
    const dot = document.getElementById('dot-general');
    const btn = document.getElementById('btn-action-general');

    const anyEmpty = values.some(v => v === "");
    const allEmpty = values.every(v => v === "");

    if (allEmpty) {
        dot.className = "status-dot red";
    } else if (anyEmpty) {
        dot.className = "status-dot yellow";
    } else {
        dot.className = generalCompleted ? "status-dot green" : "status-dot yellow";
    }

    btn.innerText = generalCompleted ? "Editar y Sincronizar" : "Siguiente";
};

window.processGeneralStep = async function() {
    const proj = document.getElementById('projName').value;
    const prop = document.getElementById('propNumber').value;
    const ver = document.getElementById('verNum').value;
    const desc = document.getElementById('verDesc').value;
    const fecha = document.getElementById('verDate').value;

    if (!proj || !prop || !ver || !desc) {
        return clippieSay("Faltan datos por completar.", "error");
    }

    try {
        await Word.run(async (context) => {
            // Sincronizar campos
            const tags = { projName: proj, propNumber: prop };
            for (let key in tags) {
                const controls = context.document.contentControls.getByTag(key);
                controls.load("items");
                await context.sync();
                if (controls.items.length > 0) controls.items[0].insertText(tags[key], "Replace");
            }

            // Insertar fila en tabla HistorialTable
            const tables = context.document.body.tables;
            tables.load("items");
            await context.sync();
            const historyTable = tables.items.find(t => t.title === "HistorialTable");
            if (historyTable) {
                const newRow = historyTable.addRows("End", 1);
                newRow.values = [[ver, desc, fecha]];
            }

            await context.sync();
            generalCompleted = true;
            checkGeneralStatus();
            clippieSay("Sincronización exitosa.", "success");
            setTimeout(() => showView('view-menu'), 800);
        });
    } catch (e) {
        clippieSay("Error: No se encontró la tabla o campos.", "error");
    }
};

window.clippieSay = function(msg, type = 'info') {
    const b = document.getElementById('clippie-text');
    const a = document.getElementById('clippie-avatar');
    if (!b || !a) return;
    b.innerText = msg;
    a.style.background = (type === 'success') ? "#107c10" : (type === 'error') ? "#d83b01" : "#004a99";
};

Office.onReady((info) => {
    if (info.host === Office.HostType.Word) {
        const dateInput = document.getElementById("verDate");
        if(dateInput) dateInput.value = new Date().toLocaleDateString();
        clippieSay("Sistema Emerson DeltaV listo.");
    }
});