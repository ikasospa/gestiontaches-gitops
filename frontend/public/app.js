// window.API_BASE_URL est injecté dans config.js au démarrage du conteneur
// (voir docker-entrypoint.sh) : l'URL de l'API n'est jamais figée dans le build.
const API_URL = `${window.API_BASE_URL}/tasks`;
 
const form = document.getElementById("task-form");
const idField = document.getElementById("task-id");
const titleField = document.getElementById("title");
const descField = document.getElementById("description");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const list = document.getElementById("task-list");
const statusEl = document.getElementById("status");
 
function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = "status" + (kind ? " " + kind : "");
}
 
async function loadTasks() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderTasks(data.tasks);
    setStatus(`${data.tasks.length} tâche(s) — répondu par le pod ${data.pod}`, "ok");
  } catch (err) {
    setStatus(`Impossible de contacter l'API (${err.message})`, "error");
  }
}
 
function renderTasks(tasks) {
  list.innerHTML = "";
  for (const t of tasks) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.id}</td>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.description || "")}</td>
      <td>—</td>
      <td class="actions">
        <button class="edit" data-id="${t.id}">Modifier</button>
        <button class="delete" data-id="${t.id}">Supprimer</button>
      </td>`;
    list.appendChild(tr);
  }
}
 
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
 
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = idField.value;
  const payload = { title: titleField.value, description: descField.value };
 
  try {
    const res = await fetch(id ? `${API_URL}/${id}` : API_URL, {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    resetForm();
    await loadTasks();
  } catch (err) {
    setStatus(`Erreur : ${err.message}`, "error");
  }
});
 
list.addEventListener("click", async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
 
  if (e.target.classList.contains("delete")) {
    if (!confirm(`Supprimer la tâche #${id} ?`)) return;
    try {
      const res = await fetch(`${API_URL}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTasks();
    } catch (err) {
      setStatus(`Erreur : ${err.message}`, "error");
    }
  }
 
  if (e.target.classList.contains("edit")) {
    try {
      const res = await fetch(`${API_URL}/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      idField.value = data.task.id;
      titleField.value = data.task.title;
      descField.value = data.task.description || "";
      submitBtn.textContent = "Enregistrer";
      cancelBtn.classList.remove("hidden");
    } catch (err) {
      setStatus(`Erreur : ${err.message}`, "error");
    }
  }
});
 
cancelBtn.addEventListener("click", resetForm);
 
function resetForm() {
  idField.value = "";
  titleField.value = "";
  descField.value = "";
  submitBtn.textContent = "Ajouter";
  cancelBtn.classList.add("hidden");
}
 
loadTasks();
setInterval(loadTasks, 15000);
