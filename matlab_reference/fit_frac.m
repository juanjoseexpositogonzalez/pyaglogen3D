function [x, np, fitresult ]=fit_frac(np,s,eRange)
e=1:length(np);
e=2.^(e);
np=np(end:-1:1);
% e_min=input('e_min= ');
% e_max=input('e_max= ');
e_min = eRange( 1 );
e_max = eRange( 2 );
maxi=s;
[p,S]=polyfit(log2(e(e_min:e_max)),log2(np(e_min:e_max)),1);
[y, err]=polyval(p,log2(e(e_min:e_max)),S);
%[z delta] = polyconf(p,log2(e(e_min:e_max)),S);
fitresult = fit(log2(e(e_min:e_max))',log2(np(e_min:e_max))','poly1');
ci = confint(fitresult,0.95);
er=abs(ci(1,1)-ci(2,1))/2;


z=polyval(p,log2(e),S);
ddf=abs(abs(p(1))-abs(ci(1)));
dm=s;
%s=strcat('scale= ',num2str(s))
par=strcat('D_f= ',num2str(p(1)),'\pm',num2str(ddf));


x=e/(2^length(np)-1);
x=x.*maxi;
% num2str(p(1));
% disp(['D_f= ',num2str(p(1))]);
% disp(['error=',num2str(er)]);
% disp(['Range: ', 'r_min=',num2str(x(e_min)),' and ',  'r_max=',num2str(x(e_max))] );

%clf
% hl1 = line(log2(e),log2(np),'Color','k','lineStyle','none','marker','.');
% hold on
% errorbar(log2(e(e_min:e_max)),y,err,'-k');
% %ylim([ min(log2(np))-1 max(log2(np))+1]);
% ylabel('log_2 # box')
% xlabel('log_2 (\epsilon)')
% ax1 = gca;
% set(ax1,'XColor','k','YColor','k','XAxisLocation','top','ActivePositionProperty','outerposition');
% hold on
% ax2 = axes('Position',get(ax1,'Position'),'XAxisLocation','bottom', 'YAxisLocation','right','Color','none','XColor','k','YColor','k');
% hold on
% hl2 = line(log2(x),-gradient(log2(np),log2(x(2))-log2(x(1))),'Color','k','Parent',ax2,'lineStyle','-.','marker','o');
% tp1=min(-gradient(log2(np)));
% tp2=max(-gradient(log2(np)));
% tp=abs(tp2-tp1);
% text(min(log2(x))+1,tp1+tp/10,par)
% text(min(log2(x))+1,tp1+2*tp/10,strcat('Range:  ', ' r_{min}=',num2str(x(e_min)),',  ',  ' r_{max}=',num2str(x(e_max))))
% ylabel('D_f')
% xlabel('log_2 (box size)')
% set(ax1,'Xlim',[min(log2(e)) max(log2(e))]);
% set(ax2,'Xlim',[min(log2(x)) max(log2(x))]);
