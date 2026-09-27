export interface PartnerIQBrowserOptions {
    publicKey: string;
    apiUrl?: string;
    /** Query params on the merchant's own page that carry a PartnerIQ short code, e.g. https://merchant.com/?pi_ref=sarah */
    referralParams?: string[];
    cookieDays?: number;
}
export interface IdentifyOptions {
    customerId: string;
}
export declare const PartnerIQ: {
    init(options: PartnerIQBrowserOptions): /*elided*/ any;
    /**
     * Call once per page load. If the current page URL carries one of `referralParams`
     * (e.g. a merchant embeds the short code directly rather than routing through /r/:shortCode),
     * this records the click against the real backend and persists the resulting Click ID -
     * the durable, server-side attribution identifier - alongside the anonymous id.
     * If no referral param is present, it just returns whatever attribution state already exists
     * (e.g. set previously by a /r/:shortCode redirect).
     */
    captureReferral(): Promise<{
        anonymousId: string | null;
        clickId: string | null;
    }>;
    /**
     * Links the current anonymous click to a real customer id (call at signup/login/checkout).
     * This is what makes attribution survive a later cookie deletion, or a purchase completed on a
     * different device - the backend durably associates customerExternalId with the click's
     * attribution record server-side.
     */
    identify(options: IdentifyOptions): Promise<Record<string, unknown> | null>;
    getAttribution(): {
        anonymousId: string | null;
        clickId: string | null;
    };
    /** The Click ID is the primary attribution identifier - pass it to your server (e.g. as a hidden
     * checkout field or a Cashfree/Razorpay order tag) so a server-to-server conversion call or
     * payment webhook can resolve attribution deterministically instead of by customer/anon matching. */
    getClickId(): string | null;
    clearAttribution(): void;
};
export default PartnerIQ;
