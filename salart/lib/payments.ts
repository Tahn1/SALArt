// lib/payments.ts
import { supabase } from "./supabase";
import * as WebBrowser from "expo-web-browser";

type PayOSResp = {
  data?: {
    checkoutUrl?: string;
    qrCode?: string;
    paymentLinkId?: string;
  };
};

export async function createPayOS(orderCode: number, amount: number, description?: string) {
  const { data, error } = await supabase.functions.invoke<PayOSResp>("payos-create-payment", {
    body: { orderCode, amount, description: description ?? `Salart - Don ${orderCode}` },
  });
  if (error) throw error;
  return data?.data;
}

export async function openPayOSCheckout(orderCode: number, amount: number, description?: string) {
  const res = await createPayOS(orderCode, amount, description);
  if (res?.checkoutUrl) {
    await WebBrowser.openBrowserAsync(res.checkoutUrl);
  }
  return res;
}
