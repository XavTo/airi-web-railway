# AIRI Full Self‑Host pour Railway

Une instance personnelle d’[AIRI Stage Web](https://github.com/moeru-ai/airi), avec un compte local, la synchronisation AIRI et trois modèles hébergés dans le même projet Railway. Aucune clé OpenAI, OpenRouter, ElevenLabs, Google, GitHub OAuth, Resend ou Stripe à renseigner.

| Service Railway | Rôle | Volume |
| --- | --- | --- |
| AIRI | Stage Web, interface de connexion, API et Auth AIRI, proxy HTTPS Railway | — |
| Ollama | Chat, Qwen2.5 1.5B par défaut | /root/.ollama |
| Voice | Speaches : Whisper Base multilingue et Kokoro 82M, voix française `ff_siwis` | /data |
| Postgres | PostgreSQL 18 + VectorChord, comptes et données synchronisées | /var/lib/postgresql |
| Redis | Sessions, état et coordination de l’API | /data |
| Storage | RustFS, objets privés et URL signées | /data |

Seul **AIRI** a un domaine public. Le navigateur utilise ce domaine pour toutes les requêtes du parcours de base. Les URL d’inférence exigent la session du propriétaire et ne donnent pas accès aux commandes de gestion des modèles. Les URL de média sont signées et temporaires. Les modèles et les ressources d’installation sont téléchargés depuis leurs registres ; les conversations et enregistrements ne sont pas envoyés à ces registres par le parcours par défaut.

## Premier accès

1. Dans les variables du service **AIRI**, retrouve `OWNER_EMAIL` et `OWNER_PASSWORD`. Le mot de passe et les secrets machine sont générés au déploiement. L’adresse sert d’identifiant local ; aucun message n’est envoyé.
2. Ouvre le domaine HTTPS d’**AIRI** et choisis la connexion par e-mail dans AIRI. Le compte est créé lors du premier démarrage. Le chat, la synthèse et la transcription sont déjà sélectionnés dans un navigateur neuf.
3. Attends que Qwen et les modèles vocaux soient téléchargés. Consulte les logs de **Ollama** et **Voice** si le site se charge avant la fin. Autorise le microphone dans le navigateur.

Par défaut, ce déploiement vise un seul propriétaire. Les inscriptions publiques sont fermées. La connexion sociale, les e-mails de réinitialisation et la facturation ne sont pas configurés. Utilise le même domaine dans la durée : l’URL identifie aussi le stockage local du navigateur et les redirections OAuth internes. Une modification de `OWNER_PASSWORD` après création du compte ne remplace pas son mot de passe en base. Conserve `APP_SECRET` avec tes sauvegardes PostgreSQL ; sa rotation invalide les sessions et peut rendre des données chiffrées illisibles.

Le rendu Live2D/VRM et certaines préférences restent dans le navigateur. Les données couvertes par les options de synchronisation AIRI sont stockées sur l’instance après connexion et activation des options correspondantes. Le template couvre le compagnon web (texte, micro et voix), pas les fonctions natives, l’overlay, les intégrations Minecraft/Factorio, les fournisseurs cloud optionnels ni la génération d’images. Le petit modèle est prévu pour un premier déploiement sur CPU. Davantage de paramètres ou des appels simultanés augmentent la mémoire et la latence. Ce mode vocal repose sur la transcription d’enregistrements, pas sur un flux bidirectionnel à faible latence.

## Préparation Railway

Le fichier `railway.toml` configure le service AIRI. Le script `scripts/railway-input.mjs` génère la topologie complète avec les références Railway, les volumes, les commandes et les secrets générés. Il faut un dépôt GitHub accessible à Railway avec le contenu de ce dossier à la racine. Aucun jeton GitHub ou Railway n’est inclus.

Sur un **nouveau projet dédié**, génère et applique une configuration **staged** :

```sh
node scripts/railway-input.mjs PROJECT_ID ENVIRONMENT_ID WORKSPACE_ID OWNER/REPO BRANCH > airi.runtime.json
railway api -f deploy/stage.graphql --variables @airi.runtime.json
```

Le script reprend l’ID du template public AIRI comme point de départ pour l’API `templateDeployV2`, en lui passant la nouvelle topologie et `stageOnly: true`. Il ne modifie pas le template existant. Un JSON généré n’est pas un fichier d’import universel Railway. Examine la préparation sur le canvas, puis clique sur **Deploy** pour lancer l’infrastructure et sa facturation. Une fois ce projet validé, génère le template natif depuis le projet :

```sh
railway templates create --project PROJECT_ID --environment production
```

Vérifie dans le composeur que les mots de passe sont des expressions `${{secret(...)}}` et que les variables inter-services restent des références. Ne publie jamais les valeurs calculées de ton environnement de test. Railway distingue le brouillon et la publication sur le Marketplace. Voir [création d’un template](https://docs.railway.com/templates/create) et [CLI Railway](https://docs.railway.com/cli/templates).

Pour modifier les modèles après déploiement, change `OLLAMA_MODEL` sur **Ollama**, ou `TTS_MODEL`, `STT_MODEL` et `TTS_VOICE` sur **Voice**, puis redéploie les services concernés. Les nouveaux navigateurs prennent les nouveaux choix par défaut ; sur un navigateur déjà configuré, adapte les modèles dans AIRI. Évite les variantes Ollama avec le suffixe `-cloud`. Garde les six services dans la même région et l’environnement privé. Surveille les limites de RAM et la taille des volumes pendant le premier téléchargement.

## Essai local et validation

```sh
./scripts/local-env.sh
docker compose up --build -d
# En gardant les valeurs uniquement dans ton terminal :
set -a; . ./.env; set +a
./scripts/smoke.sh http://localhost:8080
```

La construction compile AIRI depuis le [commit épinglé](https://github.com/moeru-ai/airi/commit/27ff2f65bfb56b82540e2a12c06925ec02049efe). Les modifications du build forcent les URL de l’application vers le domaine courant et limitent la création de comptes à l’initialisation locale. Pour tester la passerelle avec des services simulés, installe Caddy 2, puis lance `node --test tests/gateway.test.mjs`.

Sur Railway, relance `scripts/smoke.sh https://TON-DOMAINE` après le démarrage. Ce test exerce la connexion réelle, les refus anonymes, un échange avec Qwen, la synthèse Kokoro et la transcription Whisper. Termine par une connexion depuis deux profils de navigateur : active la synchro d’historique, crée une conversation et vérifie qu’elle apparaît dans le second profil ; vérifie aussi l’import d’un avatar et sa lecture après redéploiement. Programme des sauvegardes PostgreSQL et RustFS avant d’y conserver des données utiles.

AIRI et les moteurs sont distribués selon leurs propres licences. Ce projet est une configuration communautaire indépendante de l’équipe AIRI.
