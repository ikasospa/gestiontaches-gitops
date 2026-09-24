FROM nginx:1.27-alpine
 
COPY public/ /usr/share/nginx/html/
COPY docker-entrypoint.sh /docker-entrypoint.sh
 
RUN chmod +x /docker-entrypoint.sh
 
EXPOSE 8080
 
ENTRYPOINT ["/docker-entrypoint.sh"]
