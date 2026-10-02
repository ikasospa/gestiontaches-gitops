# gestiontaches-gitops

Projet GitOps : déploiement automatisé de l'application **Gestion des Tâches**
(frontend SPA Nginx + backend API Flask + PostgreSQL) via un pipeline
CI/CD GitHub Actions et deux Applications ArgoCD distinctes (backend & frontend).

## Architecture

- **Frontend** : Nginx (SPA) — namespace `gestion-tache`
- **Backend** : API Flask — namespace `gestion-tache`
- **Base de données** : PostgreSQL 17 — namespace `postgres`
- **Orchestration** : Kubernetes (3 nœuds : `k8s-manager`, `k8s-worker1`, `k8s-worker2`)
- **CI/CD** : GitHub Actions (build + push + GitOps)
- **GitOps** : 2 Applications ArgoCD (`backend-app`, `frontend-app`)
- **LoadBalancer** : MetalLB — pool `192.168.56.50-192.168.56.90`
- **Namespace principal** : `gestion-tache`

## Structure du dépôt

```
gestiontaches-gitops/
├── argocd-app-backend.yaml              # Application ArgoCD du backend
├── argocd-app-frontend.yaml             # Application ArgoCD du frontend
├── namespaces.yaml                      # Crée le namespace gestion-tache
│
├── backend/                             # API Flask
│   ├── app.py
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── gestion-flask.yaml               # Deployment + Service (fichier unique)
│   ├── jobs/
│   │   ├── postgres-backup-cronjob.yaml # CronJob sauvegarde (02h00)
│   │   ├── postgres-backup-storage.yaml # PersistentVolume + PVC
│   │   └── postgres-networkpolicy.yaml  # NetworkPolicy (backend uniquement)
│   └── postgres/
│       ├── postgres-deployment.yaml     # Déploiement PostgreSQL
│       └── postgres-vpa.yaml            # VerticalPodAutoscaler
│
├── frontend/                            # Application Nginx (SPA)
│   ├── public/
│   ├── docker-entrypoint.sh
│   ├── Dockerfile
│   ├── frontend-configmap.yaml
│   ├── frontend-deployment.yaml
│   ├── frontend-hpa.yaml
│   └── frontend-service.yaml
│
└── dashboard/
    └── admin-user.yaml                  # Hors périmètre du projet 
```

## 0. Prérequis

Les éléments suivants doivent **déjà être en place** :

- Cluster Kubernetes (1.36.4) avec 3 nœuds
- MetalLB configuré (pool `192.168.56.50-192.168.56.90`)
- `metrics-server` installé (pour les HPA)
- Un compte Docker Hub
- Un dépôt GitHub

## 1. Installer ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl wait --for=condition=available --timeout=300s deployment --all -n argocd

# Exposer l'UI via MetalLB
kubectl patch svc argocd-server -n argocd -p '{"spec": {"type": "LoadBalancer"}}'
kubectl get svc argocd-server -n argocd -w
```

**Mot de passe admin initial** :

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

**Connexion CLI** (facultatif) :

```bash
# Installer la CLI ArgoCD
curl -sSL -o /tmp/argocd \
  https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x /tmp/argocd && sudo mv /tmp/argocd /usr/local/bin/argocd

# Se connecter
argocd login 192.168.56.50 --username admin --insecure
```

## 2. Préparer le dépôt Git

```bash
cd gestiontaches-gitops
git init
git add .
git commit -m "Initial commit : squelette GitOps backend + frontend"
git branch -M main
git remote add origin https://github.com/ikasospa/gestiontaches-gitops.git
git push -u origin main
```

## 3. Secrets GitHub Actions

Dans le dépôt GitHub : **Settings → Secrets and variables → Actions** :

| Secret               | Valeur                                                                                      |
|----------------------|---------------------------------------------------------------------------------------------|
| `DOCKERHUB_USERNAME` | `ikasospa`                                                                                  |
| `DOCKERHUB_TOKEN`    | Un Access Token (hub.docker.com → Account Settings → Personal access tokens → Read & Write) |

## 4. Créer les deux Applications ArgoCD

Contrairement à une approche monolithique, ce projet utilise **deux Applications ArgoCD** distinctes, ce qui permet :

- Une **synchronisation indépendante** du backend et du frontend
- Une **meilleure lisibilité** dans l'UI ArgoCD (deux arbres séparés)
- Un **périmètre clair** : chaque app ne surveille que son sous-dossier
- Une **résolution du problème d'auto-référence** (aucune app ne se voit elle-même)

```bash
kubectl apply -f namespaces.yaml
kubectl apply -f argocd-app-backend.yaml
kubectl apply -f argocd-app-frontend.yaml

# Vérifier
kubectl get applications -n argocd
# Attendu :
# NAME                     SYNC STATUS   HEALTH STATUS
# backend-app     Synced        Healthy
# frontend-app    Synced        Healthy

# En CLI
argocd app list
argocd app get backend-app
argocd app get frontend-app
```

### Configuration des deux Applications

**`argocd-app-backend.yaml`** :

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: backend-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: 'https://github.com/ikasospa/gestiontaches-gitops.git'
    targetRevision: HEAD
    path: 'backend'
    directory:
      recurse: true
  destination:
    server: 'https://kubernetes.default.svc'
    namespace: gestion-tache
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

**`argocd-app-frontend.yaml`** :

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: frontend-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: 'https://github.com/ikasospa/gestiontaches-gitops.git'
    targetRevision: HEAD
    path: 'frontend'
    directory:
      recurse: true
  destination:
    server: 'https://kubernetes.default.svc'
    namespace: gestion-tache
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

## 5. Déclencher le pipeline CI/CD

Le workflow `.github/workflows/ci-cd.yml` se déclenche sur un push modifiant
`backend/**` ou le workflow lui-même.

```bash
# Déclencher manuellement (commit vide)
git commit --allow-empty -m "test: déclenche le pipeline CI/CD backend"
git push origin main
```

### Ce que fait le pipeline

1. **Job `build-and-push`** :
   - Calcule le tag SHA court (7 caractères)
   - Build l'image Docker du backend
   - Push sur Docker Hub :
     - `docker.io/ikasospa/stateful-flask:<sha>`
     - `docker.io/ikasospa/stateful-flask:latest`

2. **Job `update-manifest`** :
   - `sed` remplace la ligne `image:` dans `backend/gestion-flask.yaml`
   - Commit + push avec `[skip ci]` (évite la boucle)

3. **ArgoCD** (`backend-app`) détecte le changement et redéploie automatiquement.

### Vérifications

- **GitHub Actions** : onglet Actions → les 2 jobs doivent passer
- **ArgoCD** : `backend-app` repasse à `Synced + Healthy`
- **Kubernetes** : `kubectl get pods -n gestion-tache` → nouveaux pods backend

## 6. Test de montée en charge (HPA Frontend)

Le backend n'a PAS de HPA — seul le frontend en a un.

Récupère l'IP du LoadBalancer frontend :

```bash
kubectl get svc frontend-service -n gestion-tache
# EXTERNAL-IP : 192.168.56.51
```

Test avec `oha` (ou `ab`, `wrk`, etc.) :

```bash
oha -n 100000 -c 200 http://192.168.56.51/
```

**En parallèle**, observe :

```bash
watch kubectl get hpa -n frontend
watch kubectl get pods -n gestion-tache
```

**À documenter dans le rapport** :
- Nombre de réplicas avant charge (2)
- Pic observé (jusqu'à 6 pour le frontend HPA)
- Fenêtre de stabilisation (~60s avant scale-down)
- Retour à `minReplicas: 2` après arrêt

## Accès aux services

| Service           | URL                       | Notes                                     |
|-------------------|---------------------------|-------------------------------------------|
| **Frontend**      | http://192.168.56.51      | Nginx SPA                                 |
| **Backend API**   | http://192.168.56.52:5000 | Flask                                     |
| **ArgoCD UI**     | https://192.168.56.50     | `admin` / mot de passe initial            |
| **K8s Dashboard** | https://192.168.56.58     | Token d'accès (hors périmètre)            |
| **Postgres**      | Interne                   | `postgres.postgres.svc.cluster.local:5432`|

## Commandes utiles

```bash
# Statut des deux Applications ArgoCD
kubectl get applications -n argocd

# Pods backend
kubectl get pods -n gestion-tache -l app=stateful-flask

# Pods frontend
kubectl get pods -n gestion-tache -l app=frontend

# Logs backend
kubectl logs -n gestion-tache -l app=stateful-flask --tail=50

# PV/PVC
kubectl get pv
kubectl get pvc -n postgres

# CronJobs
kubectl get cronjob -n postgres

# VPA
kubectl get vpa -n postgres

# Forcer une synchro ArgoCD (backend)
argocd app sync backend-app
# ou via kubectl :
kubectl patch application backend-app -n argocd \
  --type merge \
  -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'

# Forcer une synchro ArgoCD (frontend)
argocd app sync frontend-app
```

## Tests

```bash
# Tester le backend (API Flask)
curl http://192.168.56.52:5000/

# Tester le frontend
curl http://192.168.56.51/

# Tester la connectivité Postgres depuis le backend
kubectl exec -n gestion-tache deployment/stateful-flask -- \
  sh -c 'nc -z postgres.postgres.svc.cluster.local 5432 && echo "OK"'
```

## Livrables

- Dépôt Git `gestiontaches-gitops` avec pipeline CI/CD fonctionnel
- Deux Applications ArgoCD en `Synced / Healthy` :
  - `backend-app`
  - `frontend-app`
- Capture d'écran de l'UI ArgoCD (arbre des ressources)
- Capture d'écran du pipeline GitHub Actions (2 jobs verts)
- Rapport avec :
  - Architecture du pipeline
  - Comportement du HPA frontend sous charge
  - Difficultés rencontrées et solutions
  - Retour d'expérience

## Points clés du projet

### CI/CD

- **Déclencheur** : push sur `main` modifiant `backend/**`
- **Tag d'image** : SHA court du commit (7 caractères) → traçabilité parfaite
- **GitOps** : le pipeline modifie le manifeste K8s puis commit
- **ArgoCD** : détecte le nouveau tag et redéploie automatiquement

### Deux Applications ArgoCD

| Application             | Chemin surveillé | Cible                     |
|-------------------------|------------------|---------------------------|
| `backend-add`           | `backend/`       | Namespace `gestion-tache` |
| `frontend-app`          | `frontend/`      | Namespace `gestion-tache` |

**Avantages** :
- Pas d'auto-référence (chaque app ne se voit pas elle-même)
- Sync indépendante (le backend peut être redéployé sans toucher au frontend)
- Visualisation claire dans l'UI ArgoCD

### Namespaces

- `gestion-tache` : backend + frontend
- `postgres` : base de données + jobs de sauvegarde
- `frontend` : HPA
- `argocd` : ArgoCD
- `metallb-system` : MetalLB

### Stockage

- `postgres-pv` / `postgres-pvc` : données PostgreSQL
- `postgres-backup-pv` / `postgres-backup-pvc` : sauvegardes (5 Gi)

### Autoscaling

- **Frontend HPA** : 50% CPU, 2 → 8 réplicas
- **Postgres VPA** : 100m-2 CPU, 128Mi-2Gi RAM

## Périmètre du projet

Le dossier `dashboard/` (contenant `admin-user.yaml`) est **hors périmètre**
du projet GitOps. Il s'agit d'un manifeste de configuration du Kubernetes
Dashboard qui a été conservé à titre de référence mais n'est pas géré par
les Applications ArgoCD décrites ci-dessus.

## Auteur

- **GitHub** : [@ikasospa](https://github.com/ikasospa)
- **Docker Hub** : [ikasospa](https://hub.docker.com/u/ikasospa)
- **Année** : 2026

## 📄 Licence

MIT
