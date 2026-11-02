import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * DRAFT legal documents. They describe what the software actually does with data, so a
 * solicitor has accurate facts to work from. NOT reviewed: do not rely on them as-is.
 */
const COMPANY = process.env.LEGAL_ENTITY ?? "[Company name, registered address, company number]";
const CONTACT = process.env.PRIVACY_CONTACT ?? "[privacy contact email]";

const DOCS = {
  terms: {
    title: "Terms of service",
    sections: [
      ["Who we are", `Rota Agent is provided by ${COMPANY}. "You" means the business that signs up (the "Customer") and the people it invites.`],
      ["The service", "Rota Agent helps you build staff rotas, check them against working-time rules you configure and UK law, manage swaps, holiday, time and attendance, and export hours for payroll. Suggestions from the software, including AI-translated rules and legal checks, are aids: you remain the employer and are responsible for the rotas you publish and the pay you make."],
      ["Accounts", "You must keep sign-in details secure and only invite people who work for you. The Account Primary controls roles, permissions and data for the account."],
      ["Fees", "Plans are billed per site, monthly, through Stripe. Group discounts apply as shown at checkout. You can cancel at any time; access continues to the end of the paid period."],
      ["Your data", "You own the data you put in. You can export it at any time from Settings. 30 days after cancelling, all data for the cancelled site is permanently deleted."],
      ["Acceptable use", "Don't use the service to break the law, to store data it isn't designed for (e.g. health records, bank details, national insurance numbers), or to try to access other customers' data."],
      ["Availability", "We aim for high availability but don't guarantee it. Planned maintenance will be announced where possible."],
      ["Liability", "[To be drafted by a solicitor: limitation of liability, exclusions, cap.]"],
      ["Changes and law", "We'll give 30 days' notice of material changes. These terms are governed by the law of England and Wales."],
    ],
  },
  privacy: {
    title: "Privacy notice",
    sections: [
      ["Controller and processor", `For staff data, the Customer (the employer) is the controller and ${COMPANY} is its processor. For account and billing contacts, ${COMPANY} is the controller. Contact: ${CONTACT}.`],
      ["What we hold about staff", "Name, email (optional), mobile (optional, for SMS), the roles and contract hours your employer sets, availability, shifts, holiday requests, clock-in times, right-to-work check dates, 48-hour opt-out date, qualification expiry dates, an age band for minimum wage, payroll reference and (if your employer enables it) an hourly pay rate. We don't store addresses, dates of birth, national insurance numbers or bank details."],
      ["Clocking in", "Staff clock in, take breaks and clock out on a shared screen at the workplace by choosing their name and entering their PIN. We record the times only; no location or device data is collected."],
      ["AI", "Rules written in plain English, and questions to the rota assistant, are sent to Anthropic's API to be understood. Pay rates are never sent. Anthropic processes this as our sub-processor and does not use it to train models."],
      ["Why", "To run the employer's rota, time and holiday processes (the employer's legitimate interests and legal obligations, e.g. working-time records), and to provide the service under contract."],
      ["Sharing", "Sub-processors: hosting (Vercel) and database (Neon Postgres), EU/UK region, payments (Stripe, account holders only), email (Resend), SMS (Twilio, if enabled), AI (Anthropic). No data is sold."],
      ["How long", "While the employer's account is active, then deleted 30 days after cancellation. Employers can delete individual staff records at any time. Audit logs are kept with the account."],
      ["Your rights", "You can ask your employer, or us, for access, correction or deletion. You can complain to the ICO (ico.org.uk)."],
    ],
  },
  dpa: {
    title: "Data processing agreement",
    sections: [
      ["Parties and scope", `Between the Customer (controller) and ${COMPANY} (processor), for personal data processed to provide Rota Agent. Forms part of the Terms of service.`],
      ["Instructions", "We process personal data only on the Customer's documented instructions, which are the Terms, this agreement and the Customer's use of the product's settings."],
      ["Confidentiality and security", "Staff with access are bound by confidentiality. Measures include encryption in transit, row-level access control per account, hashed PINs, signed sessions, audit logs of rota and approval actions, rate limiting and least-privilege service keys."],
      ["Sub-processors", "Listed in the privacy notice. We'll give 30 days' notice of changes; the Customer may object and terminate if the change is unacceptable."],
      ["Assistance", "We help the Customer respond to data subject requests (export and deletion are self-service) and with breach notification: we'll notify the Customer without undue delay, and within 48 hours of becoming aware of a breach affecting its data."],
      ["Deletion and return", "On cancellation, data is available for export for 30 days and then deleted."],
      ["International transfers", "[To be confirmed: hosting region and the UK IDTA / addendum for any US sub-processors.]"],
      ["Audits", "[To be drafted: audit rights and how they're exercised.]"],
    ],
  },
} as const;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc as keyof typeof DOCS];
  if (!d) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <strong>Draft for solicitor review.</strong> This describes how the software handles data so it can be turned into a binding document. It has not been legally reviewed.
      </p>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{d.title}</h1>
      <div className="space-y-6">
        {d.sections.map(([h, body]) => (
          <section key={h}>
            <h2 className="mb-1 font-semibold">{h}</h2>
            <p className="text-sm leading-relaxed text-zinc-700">{body}</p>
          </section>
        ))}
      </div>
      <nav className="mt-10 flex gap-4 text-sm text-zinc-500">
        {Object.entries(DOCS).map(([k, v]) => <Link key={k} href={`/legal/${k}`} className="underline">{v.title}</Link>)}
      </nav>
    </main>
  );
}
