# Déploiement

Un binaire, un fichier de config, un fichier de base. Rien d'autre.

---

## 1. Construire

```bash
make build
```

Produit `lore-engine`, avec le frontend embarqué (`go:embed`). Copier le
binaire suffit — il n'y a pas de dossier `dist/` à déployer à côté.

## 2. Les deux secrets

```bash
openssl rand -hex 32   # pour jwt.secret
openssl rand -hex 32   # pour crypto.key
```

```toml
[jwt]
secret = "…"

[crypto]
key = "…"
```

**`jwt.secret`** signe les sessions. Le serveur refuse de démarrer sans, et
refuse aussi de démarrer avec une valeur publique connue (celles de ce dépôt)
dès qu'il n'écoute pas uniquement sur `localhost`. Sur localhost, c'est un
simple avertissement — le développement n'est pas gêné.

**`crypto.key`** chiffre les clés d'API stockées en base. Si elle est vide,
`jwt.secret` est utilisé à la place : c'est ce que faisaient les installations
existantes, donc rien ne devient illisible. Mais dans ce cas, **changer
`jwt.secret` rend toutes les clés d'API enregistrées indéchiffrables** (« clé
illisible » dans les Paramètres). Renseigner `crypto.key` sépare les deux et
rend la rotation du secret de session sans danger.

> Si vous devez changer `crypto.key` alors que des clés sont déjà stockées :
> ressaisissez-les dans **Paramètres** après le changement. Il n'y a pas de
> migration automatique — la valeur d'origine n'est plus récupérable.

## 3. Inscriptions

```toml
[auth]
registration = "closed"
```

Par défaut `open` : n'importe qui atteignant l'URL peut créer un compte. Sur une
instance publique, mettre `closed` et créer le premier compte avec
`[bootstrap]`. Il n'y a pas encore d'écran d'administration pour créer des
comptes — c'est pourquoi `open` reste le défaut.

## 4. Derrière un reverse proxy

Le binaire sert l'API **et** l'interface sur le même port. Un proxy TLS devant
suffit :

```nginx
server {
    listen 443 ssl;
    server_name lore.example.com;

    client_max_body_size 32m;   # téléversement d'images

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # L'écran de table utilise Server-Sent Events
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Puis, côté `lore.toml` :

```toml
[server]
host = "127.0.0.1"      # seul le proxy y accède
port = 8080
secure_cookies = true   # obligatoire dès que le site est en HTTPS

[cors]
origins = ["https://lore.example.com"]
```

Deux pièges :

- **`proxy_buffering off`** — sans lui, l'écran de table ne reçoit rien : le
  flux SSE reste bloqué dans le tampon du proxy.
- **La limitation de débit lit `X-Forwarded-For`.** Correct derrière un proxy,
  usurpable sans. N'exposez pas le port du binaire directement.

## 5. Sauvegardes

Tout l'état tient dans deux endroits :

| Quoi | Où |
|---|---|
| Données | `lore.db` (+ `-wal`, `-shm`) |
| Images téléversées | `uploads.dir`, `./data/uploads` par défaut |

La base est en mode WAL : **copier `lore.db` seul donne un fichier vide ou
périmé**. Utiliser la sauvegarde en ligne de SQLite, qui fonctionne pendant que
le serveur tourne :

```bash
sqlite3 lore.db ".backup '/sauvegardes/lore-$(date +%F).db'"
tar czf /sauvegardes/uploads-$(date +%F).tar.gz data/uploads
```

Restauration : arrêter le service, remettre le `.db` en place (sans les
`-wal`/`-shm` de l'ancienne instance), redémarrer.

## 6. Mise à jour

Le schéma est appliqué au démarrage. Les migrations qui réécrivent une table
sont conditionnelles et non fatales : si l'une échoue, la base est laissée
intacte et le serveur démarre quand même. **Sauvegardez tout de même avant de
remplacer le binaire.**

## 7. Vérification après déploiement

```bash
curl -sI https://lore.example.com/ | head -1                    # 200, l'interface
curl -s  https://lore.example.com/api/auth/csrf | head -c 40    # JSON
curl -s -o /dev/null -w '%{http_code}\n' \
     https://lore.example.com/api/campaigns                     # 401 sans session
```

Les journaux de démarrage indiquent ce qui est servi et ce qui manque :

```
Lore Engine → http://127.0.0.1:8080
  frontend  : servi depuis le binaire
  inscriptions : fermées
```

Un `WARNING:` au démarrage signale un secret faible, des cookies non sécurisés
ou la clé de chiffrement partagée. Aucun ne devrait subsister en production.

## Limites connues

Voir [authorization.md](authorization.md) § *Known gaps* — notamment l'absence
de plafond sur la taille des textes, et `GET /api/users` qui expose les emails
de tous les comptes aux utilisateurs connectés.
