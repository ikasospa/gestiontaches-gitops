import os
import socket

from flask import Flask, jsonify, request, abort
from flask_cors import CORS
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
CORS(app)  # <-- 2. Activer CORS pour toutes les routes et origines
DEFAULT_URI = (
    "postgresql://"
    "stateful-flask-user:stateful-flask-password@"
    "postgres.postgres.svc.cluster.local:5432/"
    "stateful-flask-db"
)

# Correction 1 : remplacement de 'DEFA>' par 'DEFAULT_URI'
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URI", DEFAULT_URI)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# Le frontend est servi depuis un autre namespace / une autre origine
# (une autre IP de LoadBalancer) : le navigateur fait donc des requêtes
# cross-origin. Sans CORS, le navigateur bloque les réponses même si
# l'API répond correctement.
CORS(app, resources={r"/tasks*": {"origins": "*"}})

db = SQLAlchemy(app)
migrate = Migrate(app, db)

POD = socket.gethostname()


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(80), nullable=False)
    description = db.Column(db.String(200))

    def as_dict(self):
        # Correction 2 : remplacement de 'self.des>' par 'self.description'
        return {"id": self.id, "title": self.title, "description": self.description}


@app.route("/tasks", methods=["GET"])
def get_tasks():
    items = Task.query.order_by(Task.id).all()
    return jsonify({"pod": POD, "tasks": [t.as_dict() for t in items]})


@app.route("/tasks/<int:task_id>", methods=["GET"])
def get_task(task_id):
    task = Task.query.get(task_id)
    if task is None:
        abort(404, description="Tâche introuvable")
    return jsonify({"pod": POD, "task": task.as_dict()})


@app.route("/tasks", methods=["POST"])
def create_task():
    data = request.get_json(silent=True) or {}
    if not data.get("title"):
        abort(400, description="Le champ 'title' est requis")

    # Correction 3 : fermeture propre du dictionnaire 'data.get("description", "")'
    task = Task(title=data["title"], description=data.get("description", ""))
    db.session.add(task)
    db.session.commit()

    return jsonify({"pod": POD, "task": task.as_dict()}), 201


@app.route("/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    task = Task.query.get(task_id)
    if task is None:
        abort(404, description="Tâche introuvable")

    data = request.get_json(silent=True) or {}
    if "title" in data:
        if not data["title"]:
            abort(400, description="Le champ 'title' ne peut pas être vide")
        task.title = data["title"]
    if "description" in data:
        task.description = data["description"]

    db.session.commit()
    return jsonify({"pod": POD, "task": task.as_dict()})


@app.route("/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    task = Task.query.get(task_id)
    if task is None:
        abort(404, description="Tâche introuvable")

    db.session.delete(task)
    db.session.commit()
    return jsonify({"pod": POD, "deleted": task_id}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "pod": POD})


@app.errorhandler(400)
@app.errorhandler(404)
def handle_error(e):
    return jsonify({"error": e.description}), e.code


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
