# Pending workflow

`refresh.workflow.yml` is the GitHub Actions schedule for the refresh job. It belongs at `.github/workflows/refresh.yml`.

It is parked here because the repo's push token doesn't yet have the **Workflows: Read and write** permission, and GitHub rejects pushes that add workflow files without it. Once the permission is added, move the file back with:

```
git mv ops/refresh.workflow.yml .github/workflows/refresh.yml
```
