cd /Users/guycohen1/Documents/GitHub/contracts-system
cp "app/(dashboard)/units/page.tsx" "app/(dashboard)/units/UnitsContent.tsx"
echo 'import { Suspense } from "react"; import UnitsContent from "./UnitsContent"; export default function Page() { return ( <Suspense fallback={<div className="p-8 text-slate-400">טוען...</div>}><UnitsContent /></Suspense> ); }' > "app/(dashboard)/units/page.tsx"
git add .
git commit -m "fix units suspense"
git push
cat > "/Users/guycohen1/Documents/GitHub/contracts-system/next.config.ts" << 'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist"],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
