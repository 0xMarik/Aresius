"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function PayloadConfigurator() {
    const [selectedType, setSelectedType] = useState("hosted-file");
    const [selectedFile, setSelectedFile] = useState("");

    return (
        <Tabs defaultValue="payload" className="w-full max-w-lg p-4">
            <TabsList>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="preprocessors">Preprocessors</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="payload" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="payloadNumber">Payload #</Label>
                        <Input id="payloadNumber" placeholder="1" defaultValue="1" />
                    </div>
                    <div>
                        <Label htmlFor="placeholder">Placeholder</Label>
                        <Input id="placeholder" placeholder="(empty)" />
                    </div>
                </div>

                <div>
                    <Label>Type</Label>
                    <Select defaultValue={selectedType} onValueChange={setSelectedType}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="hosted-file">Hosted File</SelectItem>
                            <SelectItem value="manual">Manual Input</SelectItem>
                            <SelectItem value="generator">Generator</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div>
                    <Label>Selected File</Label>
                    <Select disabled={!selectedType.includes("file")} value={selectedFile} onValueChange={setSelectedFile}>
                        <SelectTrigger>
                            <SelectValue placeholder="Choose file" />
                        </SelectTrigger>
                        <SelectContent>
                            {/* Replace with real file list */}
                            <SelectItem value="wordlist1.txt">wordlist1.txt</SelectItem>
                            <SelectItem value="users.txt">users.txt</SelectItem>
                        </SelectContent>
                    </Select>

                    {!selectedFile && (
                        <Alert className="mt-2 text-sm text-muted-foreground border-l-4 border-yellow-400 bg-yellow-50 p-2">
                            <AlertDescription>
                                You don’t have any files yet. Visit the <span className="underline">Files</span> page and upload a wordlist to get started.
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
            </TabsContent>

            <TabsContent value="preprocessors">
                <p>Preprocessor config goes here</p>
            </TabsContent>

            <TabsContent value="settings">
                <p>Settings config goes here</p>
            </TabsContent>
        </Tabs>
    );
}
