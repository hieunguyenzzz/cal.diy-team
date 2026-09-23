import { redirect } from "next/navigation";

// Team and organization onboarding were removed, so personal is the only plan and the plan picker is
// skipped. The route is kept because signup, email verification and onboarding redirects still land here.
const ServerPage = () => {
  return redirect("/onboarding/personal/settings");
};

export default ServerPage;
