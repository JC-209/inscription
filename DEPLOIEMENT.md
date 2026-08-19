# Déployer sur GitHub et Render

## 1. Préparer Supabase Storage

Dans Supabase, ouvre **Storage** et crée un bucket privé nommé `participant-photos`.
Le serveur peut aussi le créer automatiquement avec la clé `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Installer Git

Installe Git depuis https://git-scm.com/download/win, puis redémarre VS Code.

Dans PowerShell, exécute depuis ce dossier :

```powershell
git init
git add .
git commit -m "Préparer le déploiement"
```

Crée ensuite un dépôt vide sur GitHub, puis remplace l’adresse ci-dessous :

```powershell
git branch -M main
git remote add origin https://github.com/TON_COMPTE/inscription-site.git
git push -u origin main
```

Ne publie jamais `.env`. Il est protégé par `.gitignore`.

## 3. Créer le service Render

Dans Render :

1. **New + > Web Service**
2. Connecte le dépôt GitHub
3. Build Command : `npm install`
4. Start Command : `npm start`
5. Région : la plus proche de tes utilisateurs

Le fichier `render.yaml` contient déjà ces réglages.

## 4. Variables d’environnement Render

Ajoute ces variables dans **Environment** :

- `NODE_ENV=production`
- `DATABASE_URL` : URL PostgreSQL Supabase
- `JWT_SECRET` : nouvelle clé longue et aléatoire
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SUPABASE_URL` : URL du projet Supabase
- `SUPABASE_SERVICE_ROLE_KEY` : clé secrète service role, jamais côté navigateur
- `SUPABASE_PHOTO_BUCKET=participant-photos`

Render donnera ensuite une URL publique de type :

```text
https://inscription-site.onrender.com
```

Les photos envoyées en production sont conservées dans Supabase Storage et ne dépendent pas du disque de Render.

## Sécurité

Les secrets précédemment utilisés ont été exposés dans la conversation. Régénère le mot de passe de base de données, `JWT_SECRET`, le mot de passe admin et la clé service role avant la mise en ligne.
