'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface JoinLinksProps {
  refereeLink: string;
  playerLink: string;
}

export default function JoinLinks({ refereeLink, playerLink }: JoinLinksProps) {
  const [refereeCopied, setRefereeCopied] = useState(false);
  const [playerCopied, setPlayerCopied] = useState(false);

  async function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text or show error
    }
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">Join Links</h3>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Referee Link */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="mb-2 text-sm font-medium text-gray-700">Referee Link</h4>
          <div className="mb-3 flex justify-center">
            <QRCodeSVG value={refereeLink} size={160} />
          </div>
          <p className="mb-2 break-all text-xs text-gray-600">{refereeLink}</p>
          <button
            type="button"
            onClick={() => copyToClipboard(refereeLink, setRefereeCopied)}
            className="min-h-[44px] min-w-[44px] w-full rounded-md bg-blue-100 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-200"
          >
            {refereeCopied ? '✓ Copied!' : 'Copy Referee Link'}
          </button>
        </div>

        {/* Player Link */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="mb-2 text-sm font-medium text-gray-700">Player Link</h4>
          <div className="mb-3 flex justify-center">
            <QRCodeSVG value={playerLink} size={160} />
          </div>
          <p className="mb-2 break-all text-xs text-gray-600">{playerLink}</p>
          <button
            type="button"
            onClick={() => copyToClipboard(playerLink, setPlayerCopied)}
            className="min-h-[44px] min-w-[44px] w-full rounded-md bg-blue-100 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-200"
          >
            {playerCopied ? '✓ Copied!' : 'Copy Player Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
