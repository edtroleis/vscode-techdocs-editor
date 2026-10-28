---
template:
  version: 1
  name: Runbook
  description: Respond to an alert or run an operations procedure
  category: guide
  folder: runbooks
  fields:
    alert:
      prompt: Alert or trigger name
      default: ""
---

# {{title}}

Alert: {{alert}}

Last reviewed on {{date}} by {{owner}}.

## Impact

Who is affected and how, while the alert is firing.

## Diagnosis

1. Open the dashboard and check the main metric.
2. Look at the recent deploys.
3. Search the logs for errors in the last 15 minutes.

```bash
echo "the command that helps diagnose"
```

## Actions

1. The safest action first, and how to confirm it worked.
2. The next action, if the first one did not solve it.

## How to escalate

- Who to call, and when (for example, after 30 minutes without a fix)

## After it is solved

- Write down what happened in the incident channel
- Open a postmortem if there was customer impact
