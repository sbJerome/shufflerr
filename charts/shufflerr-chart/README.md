# shufflerr-chart

Helm chart for Shufflerr, adapted from the Seerr chart
(https://github.com/seerr-team/seerr, MIT License).

```bash
helm install shufflerr ./charts/shufflerr-chart \
  --set image.repository=<your registry>/shufflerr --set image.tag=0.1.0
```

`values.yaml` documents every option (probes, ingress, persistence for `/app/config`,
extra volumes for a read-only music folder).
