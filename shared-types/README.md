# @partneriq-io/shared-types

TypeScript types for the PartnerIQ REST API: request bodies, response records and the webhook event envelope. Use them when you call the API without the SDK, or in code shared between your server and client.

```ts
import type { WebhookEvent, ConversionCreateRequest } from '@partneriq-io/shared-types';
```

The types are generated from [`@partneriq-io/node`](https://www.npmjs.com/package/@partneriq-io/node), so they always match it. If you use the Node SDK you already have them; import from `@partneriq-io/node` instead.

Documentation: https://docs.partneriq.in/docs
