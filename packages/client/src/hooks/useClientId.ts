import { ClientQueryParams, parseURLSearchParams } from "@space/shared-data";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";

// Generate this outside the React component so that its survives strict-mode re-renders, but still generates
// one a browser visit (if the query parameter is deleted).
const oneTimeClientId = uuidv4();

export function useClientId() {
    const [searchParams, setSearchParams] = useSearchParams();
    const validatedSearchParams = parseURLSearchParams(ClientQueryParams, searchParams);

    const { "client-id": clientId } = validatedSearchParams;

    useEffect(() => {
        if (!clientId) {
            setSearchParams((searchParams) => {
                searchParams.set("client-id", oneTimeClientId);
                return searchParams;
            });
            console.info(
                `No existing client-id - generating new clientId ${oneTimeClientId} and setting it`
            );
        } else {
            console.info(`Existing client-id is ${clientId}`);
        }
    }, [clientId, setSearchParams]);

    return { clientId };
}
