"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ImportedMatch {
  id: string;
  sourceMatchId: string;
  matchDate: string | null;
  teamA: string;
  teamB: string;
  venue: string | null;
  city: string | null;
  winnerTeam: string | null;
}

export default function ImportsPage() {
  const [matches, setMatches] = useState<ImportedMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminKey, setAdminKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  // Load admin key from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("adminKey");
    if (saved) {
      setAdminKey(saved);
      setKeySaved(true);
    }
  }, []);

  // Fetch imported matches
  useEffect(() => {
    if (!keySaved) return;

    const fetchMatches = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/imported-matches", {
          headers: {
            "x-admin-key": adminKey,
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        setMatches(data.matches || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch matches");
        setMatches([]);
      } finally {
        setLoading(false);
      }
    };

    fetchMatches();
  }, [keySaved, adminKey]);

  const handleSaveKey = () => {
    if (adminKey) {
      localStorage.setItem("adminKey", adminKey);
      setKeySaved(true);
    }
  };

  const handleClearKey = () => {
    setAdminKey("");
    localStorage.removeItem("adminKey");
    setKeySaved(false);
    setMatches([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Admin Key Section */}
        <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-8">
          <h2 className="text-lg font-semibold text-blue-900 mb-3">Admin Key</h2>
          <div className="flex gap-2 mb-2">
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Enter admin key"
              className="flex-1 px-3 py-2 border border-gray-300 rounded"
            />
            <button
              onClick={handleSaveKey}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Save
            </button>
            {keySaved && (
              <button
                onClick={handleClearKey}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Clear
              </button>
            )}
          </div>
          {keySaved && <div className="text-sm text-blue-700">✓ Saved</div>}
        </div>

        {/* Matches List */}
        <div>
          <h1 className="text-3xl font-bold mb-6">Imported Matches</h1>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-4 mb-4 text-red-700">
              Error: {error}
            </div>
          )}

          {loading ? (
            <div className="text-gray-600">Loading...</div>
          ) : matches.length === 0 ? (
            <div className="text-gray-600">
              No imported matches found. Import some Cricsheet JSON files to get started.
            </div>
          ) : (
            <div className="bg-white rounded shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Match</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Venue</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Result</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match) => (
                    <tr key={match.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {match.teamA} vs {match.teamB}
                        </div>
                        <div className="text-xs text-gray-500">ID: {match.sourceMatchId}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {match.matchDate
                          ? new Date(match.matchDate).toLocaleDateString()
                          : "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {match.venue || match.city || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {match.winnerTeam ? (
                          <span className="font-semibold">
                            Team {match.winnerTeam} won
                          </span>
                        ) : (
                          <span className="text-gray-500">In Progress</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/imports/${match.id}`}
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          View Timeline
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
