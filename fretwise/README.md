# Fretwise LMS prototype

This repository is based on the upstream Headless LMS source, retained under its MIT license. It is a local evaluation environment, not a production service. The `upstream` Git remote points to the original project; no Fretwise remote has been configured.

## Start

From the repository root, run `./fretwise/start-local.sh`. Open the admin at http://localhost:8001 and the student portal at http://localhost:8002. The API is on port 8000. Create an admin account and an organisation in the admin app. Press Ctrl+C to stop the apps; `./fretwise/stop-database.sh` stops the local database.

This initial machine setup uses Homebrew PostgreSQL on port 8005 and local, ignored credentials in `.env`. Its database files and captured test emails are in `tmp/`; they are not in Git. Keep them private. This setup is specific to this machine. For a fresh installation see the upstream README and self-hosting documentation. Do not use real customer information here.

Object storage and outgoing email are not configured. Test emails are written to `tmp/emails`; upload and file-related features require a storage service. Docker is not installed on this machine.

## Fretwise evaluation

1. Create a sample course, module and lesson. Try embedding a Vimeo video and marking the lesson complete.
2. Explore whether a separate course or another existing content type provides a good basis for an Insider Feed. Check publishing workflow, chronological presentation, completion and access.
3. Try comments, replies and moderation on a lesson and the proposed feed item.
4. Test an invited student, course access and progress. Invitations are captured in the local email directory.
5. Before migration, verify historical completion and comment import, customer identity, WordPress metadata mappings, subscription changes and reconciliation. None is implemented here.

The supplied apps and their UI are upstream defaults. Vimeo embed behaviour, feed modelling, historical imports and a WooCommerce/WordPress integration still require investigation and implementation. This repository is an evaluation starting point; it is not ready for customers or production deployment.
