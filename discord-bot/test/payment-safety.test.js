import test from "node:test";
import assert from "node:assert/strict";

const {
  globalPaymentRemindersEnabled,
  parseTicketTopic,
  paymentMessageMatches,
  ticketTopic
} = await import("../src/paymentSafety.js");

test("purchase ticket topics preserve type and reminder state", () => {
  const topic = ticketTopic("123456789012345678", "open", "234567890123456789", "purchase", false);
  assert.deepEqual(parseTicketTopic(topic), {
    userId: "123456789012345678",
    status: "open",
    claimedBy: "234567890123456789",
    type: "purchase",
    paymentReminderEnabled: false
  });
});

test("old ticket topics remain readable", () => {
  assert.deepEqual(parseTicketTopic("matchintel-ticket:123456789012345678:open"), {
    userId: "123456789012345678",
    status: "open",
    claimedBy: "",
    type: "",
    paymentReminderEnabled: true
  });
});

test("payment language is detected without matching unrelated text", () => {
  for (const text of [
    "What PayPal do I send it to?",
    "How can I pay?",
    "I already paid",
    "Can you send a payment link?",
    "Do you accept Cash App or Venmo?",
    "Can I use a credit card?",
    "I will transfer the money now",
    "Is it $20?"
  ]) assert.equal(paymentMessageMatches(text), true, text);

  for (const text of [
    "I need help installing MatchIntel",
    "Please pay attention to this screenshot",
    "The app crashed after launch"
  ]) assert.equal(paymentMessageMatches(text), false, text);
});

test("global marker defaults on and supports off", () => {
  assert.equal(globalPaymentRemindersEnabled("Normal channel topic"), true);
  assert.equal(globalPaymentRemindersEnabled("Normal channel topic [MI-PAYMENT-REMINDERS:OFF]"), false);
  assert.equal(globalPaymentRemindersEnabled("[MI-PAYMENT-REMINDERS:ON]"), true);
});
