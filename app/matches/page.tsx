"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Match {
  id: string;
  teamA: string;
  teamB: string;
  createdAt: string;
}

export default function MatchesPage() {
  const [adminKey, setAdminKey] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  // Load admin key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("adminKey");
    if (saved) {
      setAdminKey(saved);
    }
  }, []);

  // Save admin key to localStorage when it changes
  useEffect(() => {
    if (adminKey) {
      localStorage.setItem("adminKey", adminKey);
    }
  }, [adminKey]);

  const loadMatches = async () => {
    if (!adminKey) {
      setError("Please enter your admin key");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/matches", {
        headers: {
          "x-admin-key": adminKey,
        },
      });

      if (res.status === 401) {
        setError("Invalid admin key. Please check and try again.");
        setMatches([]);
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load matches");
        return;
      }

      const data = await res.json();
      setMatches(data);
    } catch (err) {
      setError("Network error: " + String(err));
    } finally {
      setLoading(false);
    }
  };

  const deleteMatch = async (matchId: string, teamA: string, teamB: string) => {
    if (!confirm(`Delete match ${teamA} vs ${teamB}?\n\nThis will also delete all snapshots and predictions.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        method: "DELETE",
        headers: {
          "x-admin-key": adminKey,
        },
      });

      if (res.status === 401) {
        setError("Invalid admin key");
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete match");
        return;
      }

      // Refresh the list
      await loadMatches();
    } catch (err) {
      setError("Network error: " + String(err));
    }
  };

  const openMatch = (matchId: string) => {
    router.push(`/match?matchId=${matchId}`);
  };

  const createNewMatch = () => {
    router.push("/match");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-800 mb-8">Match Management</h1>

        {/* Admin Key Input */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Admin Key
          </label>
          <div className="flex gap-4">
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Enter your admin key"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={loadMatches}
              disabled={loading || !adminKey}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button
              onClick={createNewMatch}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              New Match
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Matches List */}
        {matches.length > 0 ? (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team A
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team B
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {matches.map((match) => (
                  <tr key={match.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(match.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {match.teamA}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {match.teamB}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => openMatch(match.id)}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => deleteMatch(match.id, match.teamA, match.teamB)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && adminKey && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
              No matches found. Click &quot;New Match&quot; to create one.
            </div>
          )
        )}
      </div>
    </div>
  );
}
