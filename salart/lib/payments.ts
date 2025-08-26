// lib/payments.ts
import { supabase } from "./supabase";
import * as WebBrowser from "expo-web-browser";

export type PayOSSession = {
  checkoutUrl?: string | null;
  qrCodeUrl?: string | null;
  paymentLinkId?: string | null;
  raw: any;
};

function pickCheckoutUrl(payload: any): string | undefined {
  return (
    payload?.data?.checkoutUrl ??
    payload?.checkoutUrl ??
    payload?.url ??
    payload?.data?.payment?.checkoutUrl
  );
}

function pickQrCodeUrl(payload: any): string | undefined {
  return (
    payload?.data?.qrCode ??
    payload?.qrCode ??
    payload?.data?.qr_content ??
    payload?.qr_content ??
    payload?.data?.payment?.qrCode
  );
}

function pickPaymentLinkId(payload: any): string | undefined {
  return (
    payload?.data?.paymentLinkId ??
    payload?.paymentLinkId ??
    payload?.data?.id ??
    payload?.id
  );
}

/**
 * Tạo phiên thanh toán PayOS.
 * Có thể gọi theo 2 cách:
 * 1) createPayOS(123, 456000, "SALART - Đơn SAL_000123", { forceNew: true })
 * 2) createPayOS({ orderCode: 123, amount: 456000, description: "...", forceNew: true })
 */
export async function createPayOS(
  orderCodeOrParams:
    | number
    | {
        orderCode: number;
        amount: number;
        description?: string;
        forceNew?: boolean;
      },
  amountArg?: number,
  descriptionArg?: string,
  opts?: { forceNew?: boolean }
): Promise<PayOSSession> {
  const isObj = typeof orderCodeOrParams === "object";
  const orderCode = isObj ? orderCodeOrParams.orderCode : Number(orderCodeOrParams);
  const amount = isObj ? (orderCodeOrParams as any).amount : Number(amountArg);
  const description = isObj
    ? (orderCodeOrParams as any).description
    : descriptionArg;
  const forceNew = isObj
    ? Boolean((orderCodeOrParams as any).forceNew)
    : Boolean(opts?.forceNew);

  const { data, error } = await supabase.functions.invoke("payos-create-payment", {
    body: {
      orderCode,
      amount,
      description: description ?? `SALART - Đơn ${orderCode}`,
      ...(forceNew ? { forceNew: true } : {}),
    },
  });
  if (error) throw error;

  // Nếu phía PayOS trả lỗi logic trong payload (không phải HTTP error)
  const hasNoArtifacts =
    !pickCheckoutUrl(data) && !pickQrCodeUrl(data);
  if (hasNoArtifacts && (data?.code && data.code !== "00")) {
    const msg = data?.error || data?.desc || data?.message || "Không nhận được phiên thanh toán từ PayOS";
    throw new Error(String(msg));
  }

  return {
    checkoutUrl: pickCheckoutUrl(data) ?? null,
    qrCodeUrl: pickQrCodeUrl(data) ?? null,
    paymentLinkId: pickPaymentLinkId(data) ?? null,
    raw: data,
  };
}

/**
 * Tạo phiên PayOS và tự mở WebBrowser nếu có checkoutUrl.
 * Gọi tương tự createPayOS:
 *   openPayOSCheckout(123, 456000, "desc", { forceNew: true })
 *   hoặc openPayOSCheckout({ orderCode: 123, amount: 456000, forceNew: true })
 */
export async function openPayOSCheckout(
  orderCodeOrParams:
    | number
    | {
        orderCode: number;
        amount: number;
        description?: string;
        forceNew?: boolean;
      },
  amountArg?: number,
  descriptionArg?: string,
  opts?: { forceNew?: boolean }
): Promise<PayOSSession> {
  // Đồng bộ cách parse tham số với createPayOS
  let res: PayOSSession;
  if (typeof orderCodeOrParams === "object") {
    res = await createPayOS(orderCodeOrParams);
  } else {
    res = await createPayOS(orderCodeOrParams, amountArg!, descriptionArg, opts);
  }

  if (res.checkoutUrl) {
    await WebBrowser.openBrowserAsync(res.checkoutUrl);
  }
  return res;
}
