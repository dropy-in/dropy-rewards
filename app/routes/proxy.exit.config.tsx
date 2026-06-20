import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const { data } = await supabase
    .from("loyalty_config")
    .select("value")
    .eq("key", "exit_config")
    .maybeSingle();

  let config: unknown = null;
  if (data?.value) {
    try {
      config = JSON.parse(data.value);
    } catch (e) {
      config = null;
    }
  }

  return new Response(JSON.stringify(config), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
};
