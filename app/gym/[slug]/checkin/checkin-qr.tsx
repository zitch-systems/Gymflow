'use client';

import { QRCodeSVG } from 'qrcode.react';

// Member self check-in QR. Encodes the staff-checkin deep link so a phone camera
// or the front desk can scan it. Client component because qrcode.react renders
// in the browser (matches the admin GymQrCode pattern).
export function CheckinQr({ value }: { value: string }) {
  return (
    <div className="m-ci-qr" aria-label="Your check-in QR code">
      <QRCodeSVG value={value} size={196} level="M" includeMargin={false} />
    </div>
  );
}
