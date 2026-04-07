const API_URL = import.meta.env.VITE_API_URL as string;
const PAYMENT_API_URL = import.meta.env.VITE_API_URL as string;

import React, { useState } from 'react';
import { CartItem, ItemStatus, Language } from '../types';
import { TRANSLATIONS } from '../constants';

interface BillingScreenProps {
  items: CartItem[];
  clearCart: () => void;
  lang: Language;
}

const BillingScreen: React.FC<BillingScreenProps> = ({ items, clearCart, lang }) => {

  const t = (TRANSLATIONS[lang] || TRANSLATIONS.en) as any;

  const [isPaid, setIsPaid] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  const unscanned = items.filter(i => i.status === ItemStatus.UNSCANNED);

  const total = items.reduce((acc, i) => acc + (i.price || 0), 0);
  const gst = 0;
  const grandTotal = total + gst;

  const handlePayNow = async () => {

    setIsLoading(true);
    setLoadingMsg("Creating order...");

    try {

      // STEP 1: Checkout
      const checkoutRes = await fetch(`${API_URL}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trolley_code: "TRL001" })
      });

      if (!checkoutRes.ok) {
        const err = await checkoutRes.json();
        alert("Checkout failed: " + (err.detail || "Unknown error"));
        setIsLoading(false);
        return;
      }

      const checkoutData = await checkoutRes.json();

      if (!checkoutData.order_id) {
        alert("Checkout failed: No order ID returned");
        setIsLoading(false);
        return;
      }

      console.log("Backend Order ID:", checkoutData.order_id);

      // STEP 2: Create Razorpay order
      setLoadingMsg("Initializing payment...");

      const res = await fetch(`${PAYMENT_API_URL}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.round(grandTotal * 100) })
      });

      if (!res.ok) {
        alert("Failed to create payment order");
        setIsLoading(false);
        return;
      }

      const order = await res.json();
      setIsLoading(false);

      // STEP 3: Open Razorpay
      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: "INR",
        name: "Smart Trolley",
        description: "Grocery Payment",
        order_id: order.id,

        handler: async function (response: any) {

          console.log("Razorpay payment success:", response);
          setTxnId(response.razorpay_order_id);
          setIsLoading(true);
          setLoadingMsg("Confirming payment...");

          try {

            // STEP 4: Mark payment success in backend
            const successRes = await fetch(`${API_URL}/payment-success`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_id: checkoutData.order_id })
            });

            if (!successRes.ok) {
              console.error("payment-success endpoint failed");
              alert("Payment done but failed to confirm. Contact support.");
              setIsPaid(true);
              setIsLoading(false);
              return;
            }

            // STEP 5: Generate receipt
            setLoadingMsg("Generating receipt...");

            const receiptRes = await fetch(
              `${API_URL}/generate-receipt?order_id=${checkoutData.order_id}`
            );

            if (!receiptRes.ok) {
              const err = await receiptRes.json();
              console.error("Receipt generation failed:", err);
              alert("Payment successful! But receipt generation failed.");
              setIsPaid(true);
              setIsLoading(false);
              return;
            }

            const receiptData = await receiptRes.json();
            console.log("Receipt data:", receiptData);

            if (receiptData.receipt_url) {
              setReceiptUrl(receiptData.receipt_url);
            }

          } catch (err) {
            console.error("Post-payment error:", err);
            alert("Payment done but something went wrong generating receipt.");
          }

          setIsPaid(true);
          setIsLoading(false);
        },

        modal: {
          ondismiss: function () {
            setIsLoading(false);
          }
        },

        theme: { color: "#594070" }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();

    } catch (err) {
      console.error("Payment error:", err);
      alert("Something went wrong. Please try again.");
      setIsLoading(false);
    }

  };

  // ── LOADING OVERLAY ──
  if (isLoading) {
    return (
      <div className="p-6 text-center flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-6"></div>
        <p className="text-gray-600 font-medium text-lg">{loadingMsg}</p>
        <p className="text-gray-400 text-sm mt-2">Please wait, do not close this page</p>
      </div>
    );
  }

  // ── SUCCESS SCREEN ──
  if (isPaid) {
    return (
      <div className="p-6 text-center animate-fade-in">

        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
          <i className="fas fa-check"></i>
        </div>

        <h2 className="text-2xl font-bold text-gray-800 mb-4">{t.pay_success}</h2>

        {receiptUrl ? (
          <button
            onClick={() => window.open(receiptUrl, "_blank")}
            className="mb-6 bg-green-600 text-white px-6 py-3 rounded-xl shadow hover:bg-green-700 active:scale-95 transition-all"
          >
            <i className="fas fa-file-invoice mr-2"></i>
            View Receipt (PDF)
          </button>
        ) : (
          <p className="mb-6 text-sm text-gray-400 italic">Receipt unavailable</p>
        )}

        <div className="bg-gray-50 rounded-2xl p-6 border-2 border-dashed border-gray-200 text-left mb-8 font-mono text-sm">

          <p className="text-center font-bold mb-4 border-b pb-2">{t.receipt_header}</p>

          {items.map(item => {
            const localizedName = item.barcode
              ? t.products[item.barcode] || item.name
              : t.products['unknown'];
            return (
              <div key={item.id} className="flex justify-between mb-1">
                <span>{localizedName?.slice(0, 15)}</span>
                <span>₹{item.price}</span>
              </div>
            );
          })}

          <div className="border-t mt-4 pt-2 font-bold flex justify-between">
            <span>{t.grand_total}</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </div>

          {txnId && (
            <p className="mt-4 text-[10px] text-center text-gray-400">
              {t.txn_id}: {txnId}
            </p>
          )}

        </div>

        <button
          onClick={() => {
            setIsPaid(false);
            setReceiptUrl(null);
            setTxnId(null);
            clearCart();
          }}
          className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-indigo-700 active:scale-95 transition-all"
        >
          {t.close_new}
        </button>

      </div>
    );
  }

  // ── BILLING SCREEN ──
  return (

    <div className="p-4">

      <h2 className="text-xl font-bold text-gray-800 mb-6">{t.billing_title}</h2>

      {unscanned.length > 0 ? (

        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-center">
          <i className="fas fa-exclamation-circle text-red-500 text-4xl mb-4"></i>
          <h3 className="text-lg font-bold text-red-800 mb-2">{t.unscanned_alert}</h3>
          <p className="text-sm text-red-600 mb-6">{t.unscanned_desc}</p>
        </div>

      ) : items.length === 0 ? (

        <div className="text-center py-20">
          <i className="fas fa-receipt text-gray-100 text-6xl mb-4"></i>
          <p className="text-gray-400 italic">{t.empty_billing_prompt}</p>
        </div>

      ) : (

        <div className="space-y-6">

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 divide-y divide-gray-100">
            {items.map(item => {
              const localizedName = item.barcode
                ? t.products[item.barcode] || item.name
                : t.products['unknown'];
              return (
                <div key={item.id} className="py-3 flex justify-between items-center">
                  <div>
                    <p className="font-bold text-gray-800 text-sm">{localizedName}</p>
                    <p className="text-xs text-gray-400">Barcode: {item.barcode}</p>
                  </div>
                  <p className="font-bold text-gray-700">₹{item.price}</p>
                </div>
              );
            })}
          </div>

          <div className="bg-indigo-50 rounded-2xl p-6 space-y-2">

            <div className="flex justify-between text-gray-600 text-sm">
              <span>{t.subtotal}</span>
              <span>₹{total.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-gray-600 text-sm">
              <span>{t.gst}</span>
              <span>₹{gst.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-indigo-900 font-bold text-xl pt-2 border-t border-indigo-200">
              <span>{t.grand_total}</span>
              <span>₹{grandTotal.toFixed(2)}</span>
            </div>

          </div>

          <button
            onClick={handlePayNow}
            className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 hover:bg-indigo-700 active:scale-95 transition-all"
          >
            <i className="fas fa-credit-card"></i>
            {t.pay_card}
          </button>

        </div>

      )}

    </div>

  );

};

export default BillingScreen;