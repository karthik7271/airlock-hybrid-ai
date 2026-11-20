/**
 * Fictional sample letters. Every person, organization, number and address here is invented
 * (phone numbers use the reserved 555-01xx range) so the demo never touches real data.
 */
export interface SampleLetter {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  image?: string;
  text: string;
}

export const SAMPLE_LETTERS: SampleLetter[] = [
  {
    id: "medical-bill",
    title: "Hospital bill, 'final notice'",
    blurb: "A $2,384 balance with a collections threat",
    icon: "🏥",
    image: "/samples/medical-bill.png",
    text: `RIVERBEND REGIONAL MEDICAL CENTER
Patient Financial Services · 400 Larkspur Avenue · Fairhaven, OR 97455

November 9, 2026

Maria L. Delgado
1187 Willow Creek Road, Apt 4B
Ashford, OR 97401

Patient Name: Maria L. Delgado
Date of Birth: 03/14/1979
Account No: RRMC-0048213
Member ID: CBH-77310452
Date of Service: 08/22/2026 (Emergency Department)

FINAL NOTICE - BALANCE DUE

Dear Ms. Delgado,

Our records show an unpaid balance of $2,384.17 on the account above for emergency services provided on August 22, 2026. Your insurer, Cobalt Basin Health, processed the claim and applied $1,950.00 to your deductible. The remaining patient responsibility is shown below.

  Emergency room visit, Level 4 (CPT 99284)        $1,640.00
  CT scan, abdomen with contrast (CPT 74160)        $1,912.50
  Laboratory panel                                   $ 431.67
  Insurance payment                                 -$1,600.00
  Patient balance                                    $2,384.17

If payment in full or an approved payment arrangement is not received by December 9, 2026, this account may be referred to an outside collection agency, which may report it to credit bureaus.

You may be eligible for financial assistance under our Charity Care policy. Applications must be received within 240 days of the first billing statement.

To pay or set up a payment plan, call (541) 555-0142 or email billing@riverbend-rmc.example. Please have your account number ready. A card ending in 4421 is on file and will not be charged without your authorization.

Sincerely,
Patient Financial Services
Riverbend Regional Medical Center`,
  },
  {
    id: "insurance-denial",
    title: "Insurance claim denial",
    blurb: "An MRI denied as 'not medically necessary'",
    icon: "🛡️",
    text: `COBALT BASIN HEALTH PLAN
Claims Review Department · PO Box 22910 · Portland, OR 97208

November 4, 2026

James T. Okafor
52 Harbor Light Lane
Seabrook, OR 97138

Member: James T. Okafor
Member ID: CBH-55120987
Group Number: GRP-40221
Claim Number: CLM-2026-0918244
Provider: Dr. Anita Raman, Coastline Orthopedics

EXPLANATION OF BENEFITS - CLAIM DENIED

Dear Mr. Okafor,

We reviewed the claim submitted on October 12, 2026 for an MRI of the left knee (CPT 73721) performed on October 3, 2026. This claim has been denied.

Reason for denial (code M-112): The service was not medically necessary based on the information provided. Our records do not show that conservative treatment, such as six weeks of physical therapy, was tried before imaging.

Amount billed: $2,750.00
Amount allowed: $0.00
You may owe: $2,750.00

YOUR RIGHT TO APPEAL
You or your authorized representative may request an internal appeal within 180 days of receiving this notice. Include any medical records or a letter from your provider explaining why the service was needed. If your situation is urgent, you may request an expedited appeal, which we will decide within 72 hours. If we uphold the denial, you may have the right to an external review by an independent organization.

Questions? Call Member Services at 1-800-555-0177 (TTY 711), Monday to Friday, 8 a.m. to 6 p.m.

Cobalt Basin Health Plan`,
  },
  {
    id: "rent-notice",
    title: "Landlord notice to pay or quit",
    blurb: "14 days to pay $3,100 or face eviction",
    icon: "🏠",
    text: `HARBORVIEW PROPERTY MANAGEMENT LLC
1900 Commerce Street, Suite 300 · Tacoma, WA 98402 · (253) 555-0163

14-DAY NOTICE TO PAY RENT OR VACATE THE PREMISES

Date: November 12, 2026

To: Priya Raghunathan and all other occupants
Premises: 7713 Cedar Hollow Drive, Unit 12
Tacoma, WA 98408
Lease ID: HPM-LS-20931

You are hereby notified that you are in default in the payment of rent for the premises listed above. The amount now due is:

  Rent for October 2026:      $1,450.00
  Rent for November 2026:     $1,450.00
  Late fees:                  $  200.00
  TOTAL DUE:                  $3,100.00

Within fourteen (14) days after service of this notice, you must either pay the total amount due or vacate the premises. If you fail to do either, the landlord may begin an unlawful detainer (eviction) action against you.

State law requires us to tell you: if you are a low-income tenant, you may be eligible for free legal help. You may contact the Washington tenant hotline, and resources may be available through your county's rental assistance program.

Payments must be made by certified check or money order. Personal checks will not be accepted. Contact our office at leasing@harborview-pm.example to arrange payment.

Ms. Raghunathan, please note that partial payments may be accepted only with a written payment agreement.

Delivered by: Thomas Brandt, Property Manager`,
  },
  {
    id: "tax-scam",
    title: "Suspicious 'tax debt' letter",
    blurb: "Gift-card payment demand. Is it real?",
    icon: "⚠️",
    text: `FEDERAL TAX RESOLUTION BUREAU
Enforcement Division

URGENT - FINAL WARNING BEFORE LEGAL ACTION

Taxpayer: Robert E. Lindqvist
Address: 3305 Maple Grove Court, Brookside, MN 55421
SSN: XXX-XX-6619
Case Number: FTRB-88-104455

Dear Robert Lindqvist,

Our records indicate you owe $4,872.00 in unpaid federal taxes, penalties and interest. Multiple attempts to contact you have failed. A warrant for your arrest has been prepared and will be issued within 48 HOURS unless this debt is resolved.

To stop enforcement, you must pay immediately using Google Play or Apple gift cards. Purchase cards totaling $4,872.00 and call our Resolution Officer, Agent Daniel Hughes, at (612) 555-0129 to read the card numbers. Do not discuss this matter with anyone, including your bank or attorney, or the offer will be withdrawn.

You may also confirm your identity by emailing a photo of your driver's license and your bank account number to resolution.ftrb@mailbox.example.

This is your final notice.

Federal Tax Resolution Bureau`,
  },
];
