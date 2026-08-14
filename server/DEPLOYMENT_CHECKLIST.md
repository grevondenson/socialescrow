# Deployment Checklist & Runbook

This document outlines the steps and checks required for a safe and successful deployment to production.

## 1. Pre-Flight Checks

Before deploying, verify the following environment variables are correctly set in the production environment (e.g., Railway):

- [ ] `NODE_ENV` is set to `production`.
- [ ] `MONGODB_URI` points to the production database cluster.
- [ ] `REDIS_URL` points to the production Redis instance.
- [ ] `CLIENT_URL` is the canonical frontend URL (e.g., `https://www.yourapp.com`).
- [ ] `JWT_SECRET` and `REFRESH_TOKEN_SECRET` are strong, unique random strings.
- [ ] `VAULT_ENCRYPTION_KEY` is a 64-character hex string.
- [ ] `MPESA_ALLOWED_IPS` contains the current, verified list of Safaricom's production egress IPs.
- [ ] `TRUST_PROXY_HOPS` is set correctly for your infrastructure (e.g., `1` for Railway).
- [ ] `MPESA_REQUIRE_QUERY_CONFIRM` is set to `true`.

## 2. Deployment

1. Merge the feature branch into the `main` branch.
2. The CI/CD pipeline (e.g., Railway's GitHub integration) will automatically build and deploy the new version.
3. Monitor the deployment logs for any build or startup errors.

## 3. Post-Deployment Verification

Immediately after deployment, perform these checks:

1. **Health Check**: Access the `/health` endpoint. Verify that `database`, `redis`, `daraja`, and `cloudinary` all report `"status": "ok"`.
2. **Readiness Check**: Access the `/ready` endpoint. Verify that all core configurations report `"status": "ok"`.
3. **Smoke Test**: Perform a key user action, such as logging in or viewing a listing, to ensure the application is responsive.

## 4. Monitoring & Alerting (Initial Setup)

- **Log Monitoring**: Set up alerts in your logging provider (e.g., Railway's built-in logs, Datadog) for any logs with `level: "fatal"` or `level: "error"`.
- **Health Check Alerts**: Configure an external uptime monitor (e.g., UptimeRobot, Pingdom) to ping the `/health` endpoint every 5 minutes. Set up an alert if it returns a non-200 status code for two consecutive checks.

## 5. Basic Incident Runbook

### Incident: Daraja Health Check Fails (`/health` shows Daraja as degraded)
- **Impact**: Users cannot initiate new M-Pesa payments. Existing trades are unaffected.
- **Action**:
  1. Check the Daraja API status page for any reported outages.
  2. Verify that the `MPESA_CONSUMER_KEY` and `MPESA_CONSUMER_SECRET` in the environment are still valid.
  3. Check application logs for specific error messages from the `checkDarajaHealth` function.