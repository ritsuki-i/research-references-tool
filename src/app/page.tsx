"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Save, Play, BookOpen } from "lucide-react"

export default function Page() {
  const [token, setToken] = useState("")
  const [databaseId, setDatabaseId] = useState("")
  const [message, setMessage] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const savedToken = localStorage.getItem("notion_token")
    const savedDbId = localStorage.getItem("notion_db")
    if (savedToken) setToken(savedToken)
    if (savedDbId) setDatabaseId(savedDbId)
  }, [])

  const saveSettings = () => {
    localStorage.setItem("notion_token", token)
    localStorage.setItem("notion_db", databaseId)
    setMessage("設定を保存しました")
  }

  const handleProcess = async () => {
    setIsProcessing(true)
    setMessage("処理中…")

    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, databaseId }),
      })
      const data = await res.json()
      setMessage(data.message)
    } catch (error) {
      setMessage("エラーが発生しました。もう一度お試しください。")
      console.log("エラー文:", error)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-2">
            <BookOpen className="h-8 w-8 text-blue-600 mr-2" />
            <CardTitle className="text-2xl font-bold">Notion BibTeX Processor</CardTitle>
          </div>
          <CardDescription className="text-center">NotionデータベースからBibTeXデータを処理します</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token">Notion Token</Label>
            <Input
              id="token"
              type="password"
              placeholder="secret_xxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Notionの統合トークンを入力してください</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="databaseId">Database ID</Label>
            <Input
              id="databaseId"
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
              value={databaseId}
              onChange={(e) => setDatabaseId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">NotionデータベースのIDを入力してください</p>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <div className="flex gap-3 w-full">
            <Button variant="outline" onClick={saveSettings} className="flex-1">
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
            <Button
              onClick={handleProcess}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              disabled={isProcessing || !token || !databaseId}
            >
              <Play className="mr-2 h-4 w-4" />
              {isProcessing ? "処理中..." : "実行"}
            </Button>
          </div>

          {message && (
            <Alert
              className={`${message.includes("エラー") ? "bg-red-50 border-red-200" : "bg-slate-100 border-slate-200"}`}
            >
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
