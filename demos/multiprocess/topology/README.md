# Topology

This folder documents the demo node graph, address map, and route analysis.

## Files

| File | Purpose |
|------|---------|
| [node-map.md](node-map.md) | Full node graph: 4 routers, 5 bash-clientdummy instances, 6 endpoints |
| [address-map.md](address-map.md) | All 14 session/service addresses with domain prefix rationale |
| [route-analysis.md](route-analysis.md) | Manual vs announce-learned route breakdown per router |

## Quick Reference

```bash
bash demo-topology-tree.sh TOPOLOGY    # print tree + coverage matrix
```

## Node Counts

- Routers: 4 (root, east, west, nested)
- bash-clientdummy instances: 5 (alpha, delta, beta, gamma, omega)
- Business sessions: 8
- Service endpoints: 6 (console, session-control, timer, requestion, mailbox, IM)
- Total processes: 15
