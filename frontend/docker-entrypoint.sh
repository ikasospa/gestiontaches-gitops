#!/bin/sh
set -e
 
# API_BASE_URL est fourni par le Deployment Kubernetes (voir frontend-deployment.yaml).
# On le matérialise en JS à chaque démarrage du conteneur : l'image reste
# indépendante de l'adresse de l'API, qui peut changer entre environnements
# sans jamais reconstruire le frontend.
: "${API_BASE_URL:?La variable d'environnement API_BASE_URL est requise}"
 
cat > /usr/share/nginx/html/config.js <<EOF
window.API_BASE_URL = "${API_BASE_URL}";
EOF
 
exec nginx -g "daemon off;"
