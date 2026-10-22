import { describe, expect, it } from "vitest";
import { escapeLdapFilter } from "@/lib/auth/ldap";

describe("escapeLdapFilter", () => {
  it("escapes every RFC 4515 special character", () => {
    expect(escapeLdapFilter("user*(test)\\\0@example.com")).toBe(
      "user\\2a\\28test\\29\\5c\\00@example.com",
    );
  });

  it("keeps a regular corporate email unchanged", () => {
    expect(escapeLdapFilter("employee@example.com")).toBe("employee@example.com");
  });
});
