import React, { useCallback } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '../../lib/utils';

const Dropzone = ({ onFileSelect }) => {
    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFileSelect(Array.from(e.dataTransfer.files));
        }
    }, [onFileSelect]);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            onFileSelect(Array.from(e.target.files));
        }
    };

    return (
        <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center text-center hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer group"
        >
            <input
                type="file"
                multiple
                className="hidden"
                id="file-upload"
                onChange={handleFileChange}
            />
            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <UploadCloud size={24} className="text-muted-foreground group-hover:text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-1">拖拽文件到此处</h3>
                <p className="text-sm text-muted-foreground">或点击浏览文件</p>
            </label>
        </div>
    );
};

export default Dropzone;
