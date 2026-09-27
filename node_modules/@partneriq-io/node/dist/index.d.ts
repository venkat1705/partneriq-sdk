export interface PartnerIQRequestOptions {
    idempotencyKey?: string;
}
export interface ConversionCreateRequest {
    externalId: string;
    customerExternalId: string;
    amount: number;
    currency: string;
    type?: 'PURCHASE' | 'SUBSCRIPTION_RENEWAL' | string;
    occurredAt?: string;
    /** Preferred: the Click ID returned by /r/:shortCode or /api/v1/tracking/click - the primary,
     * durable attribution identifier. Resolves deterministically without customer-matching. */
    clickId?: string;
    /** Legacy: an explicit attribution record id. Prefer clickId. */
    attributionId?: string;
    metadata?: Record<string, unknown>;
}
export interface RefundCreateRequest {
    externalId?: string;
    refundExternalId?: string;
    amount?: number;
    reason?: string;
}
export interface IdentifyCustomerRequest {
    customerId: string;
    anonymousId: string;
    /** The org's public tracking key (pi_pub_...), not the secret API key used to authenticate this
     * SDK - /api/v1/tracking/identify is intentionally gated by the public key so it can also be
     * called directly from client-side JS. */
    publicKey: string;
}
export interface TrackingLinkCreateRequest {
    organizationId: string;
    programId: string;
    affiliateId: string;
    destinationUrl: string;
    campaignId?: string;
    customCode?: string;
}
export interface WebhookEndpointCreateRequest {
    url: string;
    subscribedEvents: string[];
}
export interface PartnerIQOptions {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
}
export declare class PartnerIQError extends Error {
    code: string;
    status: number;
    requestId?: string;
    details?: unknown;
    constructor(message: string, options?: {
        code?: string;
        status?: number;
        requestId?: string;
        details?: unknown;
    });
}
export declare class PartnerIQAuthenticationError extends PartnerIQError {
}
export declare class PartnerIQValidationError extends PartnerIQError {
}
export declare class PartnerIQRateLimitError extends PartnerIQError {
}
export declare class PartnerIQConflictError extends PartnerIQError {
}
export declare class PartnerIQApiError extends PartnerIQError {
}
type RequestConfig = RequestInit & {
    idempotencyKey?: string;
    retryUnsafe?: boolean;
};
export declare class PartnerIQ {
    readonly baseUrl: string;
    readonly timeout: number;
    readonly maxRetries: number;
    private readonly apiKey;
    readonly conversions: {
        create: (body: ConversionCreateRequest, options?: PartnerIQRequestOptions) => Promise<any>;
        get: (id: string) => Promise<any>;
        refund: (body: RefundCreateRequest & {
            externalId: string;
        }, options?: PartnerIQRequestOptions) => Promise<any>;
    };
    readonly customers: {
        /** Durably links a customer to their anonymous click's attribution - call this at
         * signup/login/checkout so attribution survives cookie deletion or a purchase from
         * another device. Maps to the real POST /api/v1/tracking/identify endpoint. */
        identify: (body: IdentifyCustomerRequest) => Promise<any>;
    };
    readonly trackingLinks: {
        create: (body: TrackingLinkCreateRequest) => Promise<any>;
        list: (organizationId: string, params?: {
            programId?: string;
        }) => Promise<any>;
    };
    readonly programs: {
        list: (params?: {
            limit?: number;
            cursor?: string;
        }) => Promise<any>;
    };
    readonly affiliates: {
        get: (id: string) => Promise<any>;
    };
    readonly webhooks: {
        endpoints: {
            create: (body: WebhookEndpointCreateRequest) => Promise<any>;
            list: () => Promise<any>;
        };
        verifySignature: typeof verifyWebhookSignature;
    };
    constructor(options: PartnerIQOptions);
    request(path: string, config?: RequestConfig): Promise<any>;
    private fetchOnce;
    private query;
}
export declare function verifyWebhookSignature(input: {
    rawBody: string;
    secret: string;
    signature: string;
    timestamp?: string | number;
    toleranceSeconds?: number;
}): boolean;
export default PartnerIQ;
